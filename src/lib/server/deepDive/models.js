import mongoose from 'mongoose';
import { getDeepDiveDbProvider } from '@/lib/server/deepDive/db';

const FIRESTORE_IN_QUERY_LIMIT = 30;

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

const cloneValue = (value) => {
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  }
  return value;
};

const normalizeEmbedded = (value) =>
  Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (item && typeof item.toDate === 'function') return [key, item.toDate()];
      if (Array.isArray(item)) return [key, item.map((entry) => (isPlainObject(entry) ? normalizeEmbedded(entry) : entry))];
      if (isPlainObject(item)) return [key, normalizeEmbedded(item)];
      return [key, item];
    })
  );

const normalizeDoc = (id, data) => {
  const output = { _id: id };
  Object.entries(data || {}).forEach(([key, value]) => {
    if (value && typeof value.toDate === 'function') {
      output[key] = value.toDate();
    } else if (Array.isArray(value)) {
      output[key] = value.map((item) =>
        item && typeof item.toDate === 'function'
          ? item.toDate()
          : isPlainObject(item)
            ? normalizeEmbedded(item)
            : item
      );
    } else if (isPlainObject(value)) {
      output[key] = normalizeEmbedded(value);
    } else {
      output[key] = value;
    }
  });
  return output;
};

const matchesValue = (actual, expected) => {
  if (expected?.$in) return expected.$in.some((item) => matchesValue(actual, item));
  if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
    if (expected.$gte !== undefined && !(actual >= expected.$gte)) return false;
    if (expected.$lte !== undefined && !(actual <= expected.$lte)) return false;
    return true;
  }
  return actual === expected;
};

const matchesFilter = (doc, filter = {}) =>
  Object.entries(filter).every(([key, expected]) => {
    const actual = key === '_id' ? doc._id : doc[key];
    return matchesValue(actual, expected);
  });

const applyProjection = (doc, projection) => {
  if (!projection || !Object.keys(projection).length) return doc;
  const includeKeys = Object.entries(projection)
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key);
  if (!includeKeys.length) return doc;
  const output = { _id: doc._id };
  includeKeys.forEach((key) => {
    if (doc[key] !== undefined) output[key] = doc[key];
  });
  return output;
};

const applySort = (docs, sortSpec) => {
  if (!sortSpec || !Object.keys(sortSpec).length) return docs;
  const entries = Object.entries(sortSpec);
  return [...docs].sort((left, right) => {
    for (const [field, direction] of entries) {
      const modifier = Number(direction) < 0 ? -1 : 1;
      const leftValue = field === '_id' ? left._id : left[field];
      const rightValue = field === '_id' ? right._id : right[field];
      if (leftValue === rightValue) continue;
      if (leftValue === undefined || leftValue === null) return 1;
      if (rightValue === undefined || rightValue === null) return -1;
      if (leftValue < rightValue) return -1 * modifier;
      if (leftValue > rightValue) return 1 * modifier;
    }
    return 0;
  });
};

class FirestoreQuery {
  constructor(execFn, { singleResult = false } = {}) {
    this.execFn = execFn;
    this.singleResult = singleResult;
    this.sortSpec = null;
    this.projection = null;
  }

  sort(spec) {
    this.sortSpec = spec;
    return this;
  }

  select(spec) {
    this.projection = spec;
    return this;
  }

  lean() {
    return this;
  }

  async exec() {
    const raw = await this.execFn();
    const transformOne = (doc) => (doc ? applyProjection(cloneValue(doc), this.projection) : null);
    if (Array.isArray(raw)) {
      const sorted = applySort(raw, this.sortSpec);
      if (this.singleResult) return transformOne(sorted[0] || null);
      return sorted.map(transformOne);
    }
    return transformOne(raw);
  }

  then(resolve, reject) {
    return this.exec().then(resolve, reject);
  }
}

class FirestoreCollectionModel {
  constructor(db, name) {
    this.db = db;
    this.name = name;
    this.collection = db.collection(name);
  }

  async fetchAll(filter = {}) {
    const idFilter = filter._id;
    if (typeof idFilter === 'string') {
      const snapshot = await this.collection.doc(idFilter).get();
      if (!snapshot.exists) return [];
      const doc = normalizeDoc(snapshot.id, snapshot.data());
      return matchesFilter(doc, filter) ? [doc] : [];
    }

    if (idFilter?.$in?.length) {
      const snapshots = await Promise.all(idFilter.$in.map((id) => this.collection.doc(String(id)).get()));
      return snapshots
        .filter((snapshot) => snapshot.exists)
        .map((snapshot) => normalizeDoc(snapshot.id, snapshot.data()))
        .filter((doc) => matchesFilter(doc, filter));
    }

    const inEntry = Object.entries(filter).find(([, value]) => Array.isArray(value?.$in));
    const rangeEntry = Object.entries(filter).find(([, value]) => isPlainObject(value) && (value.$gte !== undefined || value.$lte !== undefined));
    const equalityEntries = Object.entries(filter).filter(([, value]) => !isPlainObject(value) || value instanceof Date);

    const executeQuery = async (query) => {
      const snapshot = await query.get();
      return snapshot.docs.map((doc) => normalizeDoc(doc.id, doc.data()));
    };

    let docs = [];

    if (inEntry) {
      const [field, condition] = inEntry;
      const values = condition.$in.map((item) => String(item));
      for (let index = 0; index < values.length; index += FIRESTORE_IN_QUERY_LIMIT) {
        let query = this.collection;
        equalityEntries.forEach(([entryField, entryValue]) => {
          query = query.where(entryField, '==', entryValue);
        });
        if (rangeEntry) {
          const [rangeField, rangeValue] = rangeEntry;
          if (rangeValue.$gte !== undefined) query = query.where(rangeField, '>=', rangeValue.$gte);
          if (rangeValue.$lte !== undefined) query = query.where(rangeField, '<=', rangeValue.$lte);
        }
        query = query.where(field, 'in', values.slice(index, index + FIRESTORE_IN_QUERY_LIMIT));
        docs.push(...(await executeQuery(query)));
      }
    } else if (Object.keys(filter).length) {
      let query = this.collection;
      let canUseQuery = true;
      equalityEntries.forEach(([field, value]) => {
        if (field === '_id') {
          canUseQuery = false;
          return;
        }
        query = query.where(field, '==', value);
      });
      if (rangeEntry && canUseQuery) {
        const [rangeField, rangeValue] = rangeEntry;
        if (rangeValue.$gte !== undefined) query = query.where(rangeField, '>=', rangeValue.$gte);
        if (rangeValue.$lte !== undefined) query = query.where(rangeField, '<=', rangeValue.$lte);
      }
      docs = canUseQuery ? await executeQuery(query) : await executeQuery(this.collection);
    } else {
      docs = await executeQuery(this.collection);
    }

    return docs.filter((doc) => matchesFilter(doc, filter));
  }

  find(filter = {}) {
    return new FirestoreQuery(() => this.fetchAll(filter));
  }

  findOne(filter = {}) {
    return new FirestoreQuery(() => this.fetchAll(filter), { singleResult: true });
  }

  countDocuments(filter = {}) {
    return this.fetchAll(filter).then((docs) => docs.length);
  }

  async create(document) {
    const now = new Date();
    const payload = {
      ...cloneValue(document),
      createdAt: document.createdAt || now,
      updatedAt: document.updatedAt || now
    };
    const ref = this.buildRef(document) || this.collection.doc();
    await ref.set(payload);
    return { _id: ref.id, ...payload };
  }

  async updateOne(filter, update, options = {}) {
    const docs = await this.fetchAll(filter);
    const doc = docs[0] || null;
    if (!doc && !options.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
    const ref = doc ? this.collection.doc(doc._id) : this.buildRef(filter, update) || this.collection.doc();
    const next = applyUpdate(doc, filter, update, ref.id);
    await ref.set(next);
    return { matchedCount: doc ? 1 : 0, modifiedCount: doc ? 1 : 0, upsertedCount: doc ? 0 : 1, upsertedId: doc ? null : ref.id };
  }

  findOneAndUpdate(filter, update, options = {}) {
    return new FirestoreQuery(async () => {
      const docs = await this.fetchAll(filter);
      const doc = docs[0] || null;
      if (!doc && !options.upsert) return null;
      const ref = doc ? this.collection.doc(doc._id) : this.buildRef(filter, update) || this.collection.doc();
      const next = applyUpdate(doc, filter, update, ref.id);
      await ref.set(next);
      return { _id: ref.id, ...next };
    });
  }

  findOneAndDelete(filter) {
    return new FirestoreQuery(async () => {
      const docs = await this.fetchAll(filter);
      const doc = docs[0] || null;
      if (!doc) return null;
      await this.collection.doc(doc._id).delete();
      return doc;
    });
  }

  async deleteMany(filter) {
    const docs = await this.fetchAll(filter);
    await Promise.all(docs.map((doc) => this.collection.doc(doc._id).delete()));
    return { deletedCount: docs.length };
  }

  buildRef(filter = {}, update = {}) {
    const symbol = typeof filter.symbol === 'string' ? filter.symbol : update?.$set?.symbol || update?.$setOnInsert?.symbol;
    if (this.name === 'deep_dive_symbols' && symbol) return this.collection.doc(String(symbol));
    if (this.name === 'deep_dive_company_profiles' && symbol) return this.collection.doc(String(symbol));
    if (this.name === 'deep_dive_sync_state' && symbol) return this.collection.doc(String(symbol));
    if (this.name === 'deep_dive_price_bars') {
      const dateValue = filter.date instanceof Date ? filter.date : update?.$set?.date || update?.$setOnInsert?.date;
      if (symbol && dateValue instanceof Date) return this.collection.doc(`${symbol}_${dateValue.toISOString().slice(0, 10)}`);
    }
    return null;
  }
}

const buildInsertSeed = (filter = {}, id) =>
  Object.entries(filter).reduce((acc, [key, value]) => {
    if (key === '_id') return acc;
    if (!isPlainObject(value) || value instanceof Date) acc[key] = cloneValue(value);
    return acc;
  }, id ? { _id: id } : {});

const applyUpdate = (currentDoc, filter, update = {}, id) => {
  const now = new Date();
  const base = currentDoc ? cloneValue(currentDoc) : buildInsertSeed(filter, id);
  const payload = { ...base };
  if (!currentDoc && update.$setOnInsert) Object.assign(payload, cloneValue(update.$setOnInsert));
  if (update.$set) Object.assign(payload, cloneValue(update.$set));
  if (update.$min) {
    Object.entries(update.$min).forEach(([key, value]) => {
      if (payload[key] === undefined || payload[key] === null || payload[key] > value) payload[key] = cloneValue(value);
    });
  }
  if (update.$max) {
    Object.entries(update.$max).forEach(([key, value]) => {
      if (payload[key] === undefined || payload[key] === null || payload[key] < value) payload[key] = cloneValue(value);
    });
  }
  if (!payload.createdAt) payload.createdAt = currentDoc?.createdAt || now;
  payload.updatedAt = now;
  delete payload._id;
  return payload;
};

const createMongoModels = (connection) => {
  const DeepDiveSymbolSchema = new mongoose.Schema(
    {
      symbol: { type: String, required: true, trim: true, uppercase: true },
      assetType: { type: String, enum: ['stock', 'benchmark'], required: true },
      displayName: { type: String, default: '', trim: true },
      yfinanceTicker: { type: String, default: '', trim: true },
      yfinanceTickers: { type: [String], default: [] },
      benchmarkKey: { type: String, default: '', trim: true },
      active: { type: Boolean, default: true }
    },
    { timestamps: true, collection: 'deep_dive_symbols' }
  );
  DeepDiveSymbolSchema.index({ symbol: 1 }, { unique: true });
  DeepDiveSymbolSchema.index({ assetType: 1, active: 1 });

  const DeepDiveStockListSchema = new mongoose.Schema(
    {
      ownerUsername: { type: String, required: true, trim: true },
      title: { type: String, required: true, trim: true },
      description: { type: String, default: '', trim: true },
      sourceText: { type: String, default: '', trim: true },
      symbols: { type: [String], default: [] }
    },
    { timestamps: true, collection: 'deep_dive_stock_lists' }
  );
  DeepDiveStockListSchema.index({ ownerUsername: 1, title: 1 });

  const DeepDivePriceBarSchema = new mongoose.Schema(
    {
      symbol: { type: String, required: true, trim: true, uppercase: true },
      assetType: { type: String, enum: ['stock', 'benchmark'], required: true },
      date: { type: Date, required: true },
      open: { type: Number, default: null },
      high: { type: Number, default: null },
      low: { type: Number, default: null },
      close: { type: Number, default: null },
      adjClose: { type: Number, default: null },
      volume: { type: Number, default: null },
      sourceTicker: { type: String, default: '', trim: true },
      source: { type: String, default: 'yfinance', trim: true }
    },
    { timestamps: true, collection: 'deep_dive_price_bars' }
  );
  DeepDivePriceBarSchema.index({ symbol: 1, date: 1 }, { unique: true });
  DeepDivePriceBarSchema.index({ assetType: 1, date: 1 });

  const DeepDiveCompanyProfileSchema = new mongoose.Schema(
    {
      symbol: { type: String, required: true, trim: true, uppercase: true },
      companyName: { type: String, default: '', trim: true },
      sector: { type: String, default: '', trim: true },
      industry: { type: String, default: '', trim: true },
      summary: { type: String, default: '', trim: true },
      marketCap: { type: Number, default: null },
      averageVolume: { type: Number, default: null },
      averageTradedValue: { type: Number, default: null },
      sharesOutstanding: { type: Number, default: null },
      floatShares: { type: Number, default: null },
      trailingPe: { type: Number, default: null },
      priceToBook: { type: Number, default: null },
      returnOnEquity: { type: Number, default: null },
      debtToEquity: { type: Number, default: null },
      epsTrailing: { type: Number, default: null },
      dividendYield: { type: Number, default: null },
      fiftyTwoWeekHigh: { type: Number, default: null },
      fiftyTwoWeekLow: { type: Number, default: null },
      listingDate: { type: Date, default: null },
      source: { type: String, default: 'yfinance', trim: true },
      sourceTimestamp: { type: Date, default: null },
      lastProfileSyncedAt: { type: Date, default: null }
    },
    { timestamps: true, collection: 'deep_dive_company_profiles' }
  );
  DeepDiveCompanyProfileSchema.index({ symbol: 1 }, { unique: true });
  DeepDiveCompanyProfileSchema.index({ sector: 1, industry: 1 });

  const DeepDiveSyncStateSchema = new mongoose.Schema(
    {
      symbol: { type: String, required: true, trim: true, uppercase: true },
      assetType: { type: String, enum: ['stock', 'benchmark'], required: true },
      latestBarDate: { type: Date, default: null },
      earliestBarDate: { type: Date, default: null },
      lastSyncedAt: { type: Date, default: null },
      lastProfileSyncedAt: { type: Date, default: null },
      lastAttemptedAt: { type: Date, default: null },
      lastStatus: { type: String, default: '', trim: true },
      lastError: { type: String, default: '', trim: true }
    },
    { timestamps: true, collection: 'deep_dive_sync_state' }
  );
  DeepDiveSyncStateSchema.index({ symbol: 1 }, { unique: true });
  DeepDiveSyncStateSchema.index({ assetType: 1, latestBarDate: 1 });

  const DeepDiveIngestionRunSchema = new mongoose.Schema(
    {
      runType: { type: String, required: true, trim: true },
      status: { type: String, required: true, trim: true },
      startedAt: { type: Date, required: true },
      finishedAt: { type: Date, default: null },
      symbolsAttempted: { type: Number, default: 0 },
      symbolsSucceeded: { type: Number, default: 0 },
      rowsUpserted: { type: Number, default: 0 },
      failedSymbols: { type: [{ symbol: { type: String, default: '', trim: true }, error: { type: String, default: '', trim: true } }], default: [] },
      errorSummary: { type: String, default: '', trim: true }
    },
    { timestamps: true, collection: 'deep_dive_ingestion_runs' }
  );
  DeepDiveIngestionRunSchema.index({ runType: 1, startedAt: -1 });

  return {
    DeepDiveSymbol: connection.models.DeepDiveSymbol || connection.model('DeepDiveSymbol', DeepDiveSymbolSchema),
    DeepDiveStockList: connection.models.DeepDiveStockList || connection.model('DeepDiveStockList', DeepDiveStockListSchema),
    DeepDivePriceBar: connection.models.DeepDivePriceBar || connection.model('DeepDivePriceBar', DeepDivePriceBarSchema),
    DeepDiveCompanyProfile: connection.models.DeepDiveCompanyProfile || connection.model('DeepDiveCompanyProfile', DeepDiveCompanyProfileSchema),
    DeepDiveSyncState: connection.models.DeepDiveSyncState || connection.model('DeepDiveSyncState', DeepDiveSyncStateSchema),
    DeepDiveIngestionRun: connection.models.DeepDiveIngestionRun || connection.model('DeepDiveIngestionRun', DeepDiveIngestionRunSchema)
  };
};

const createFirestoreModels = (db) => ({
  DeepDiveSymbol: new FirestoreCollectionModel(db, 'deep_dive_symbols'),
  DeepDiveStockList: new FirestoreCollectionModel(db, 'deep_dive_stock_lists'),
  DeepDivePriceBar: new FirestoreCollectionModel(db, 'deep_dive_price_bars'),
  DeepDiveCompanyProfile: new FirestoreCollectionModel(db, 'deep_dive_company_profiles'),
  DeepDiveSyncState: new FirestoreCollectionModel(db, 'deep_dive_sync_state'),
  DeepDiveIngestionRun: new FirestoreCollectionModel(db, 'deep_dive_ingestion_runs')
});

export const getDeepDiveModels = (connectionOrDb) =>
  getDeepDiveDbProvider() === 'firestore' ? createFirestoreModels(connectionOrDb) : createMongoModels(connectionOrDb);
