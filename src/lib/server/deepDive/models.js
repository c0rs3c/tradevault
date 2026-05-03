import mongoose from 'mongoose';

const createModels = (connection) => {
  const DeepDiveSymbolSchema = new mongoose.Schema(
    {
      symbol: { type: String, required: true, trim: true, uppercase: true },
      assetType: { type: String, enum: ['stock', 'benchmark'], required: true },
      displayName: { type: String, default: '', trim: true },
      yfinanceTicker: { type: String, default: '', trim: true },
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
      failedSymbols: {
        type: [
          {
            symbol: { type: String, default: '', trim: true },
            error: { type: String, default: '', trim: true }
          }
        ],
        default: []
      },
      errorSummary: { type: String, default: '', trim: true }
    },
    { timestamps: true, collection: 'deep_dive_ingestion_runs' }
  );
  DeepDiveIngestionRunSchema.index({ runType: 1, startedAt: -1 });

  return {
    DeepDiveSymbol:
      connection.models.DeepDiveSymbol || connection.model('DeepDiveSymbol', DeepDiveSymbolSchema),
    DeepDiveStockList:
      connection.models.DeepDiveStockList ||
      connection.model('DeepDiveStockList', DeepDiveStockListSchema),
    DeepDivePriceBar:
      connection.models.DeepDivePriceBar || connection.model('DeepDivePriceBar', DeepDivePriceBarSchema),
    DeepDiveCompanyProfile:
      connection.models.DeepDiveCompanyProfile ||
      connection.model('DeepDiveCompanyProfile', DeepDiveCompanyProfileSchema),
    DeepDiveSyncState:
      connection.models.DeepDiveSyncState ||
      connection.model('DeepDiveSyncState', DeepDiveSyncStateSchema),
    DeepDiveIngestionRun:
      connection.models.DeepDiveIngestionRun ||
      connection.model('DeepDiveIngestionRun', DeepDiveIngestionRunSchema)
  };
};

export const getDeepDiveModels = (connection) => createModels(connection);
