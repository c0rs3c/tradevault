import mongoose from 'mongoose';

const WatchlistItemSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['section', 'ticker'], required: true },
    rawSymbol: { type: String, default: '' },
    sectionTitle: { type: String, default: '' },
    exchange: { type: String, default: '' },
    symbol: { type: String, default: '' },
    canonicalTicker: { type: String, default: '' },
    companyName: { type: String, default: '' },
    normalizedCompanyName: { type: String, default: '' }
  },
  { _id: false }
);

const WatchlistSchema = new mongoose.Schema(
  {
    ownerUsername: { type: String, required: true, index: true },
    source: { type: String, enum: ['tradingview', 'text'], default: 'tradingview', required: true },
    sourceWatchlistId: { type: String, required: true },
    sourceUrl: { type: String, default: '', trim: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    authorUsername: { type: String, default: '', trim: true },
    color: { type: String, default: '', trim: true },
    rawSymbols: { type: [String], default: [] },
    items: { type: [WatchlistItemSchema], default: [] },
    lastImportedAt: { type: Date, default: null },
    lastSyncedAt: { type: Date, default: null },
    syncStatus: { type: String, enum: ['idle', 'syncing', 'success', 'error'], default: 'idle' },
    syncError: { type: String, default: '' },
    syncProgressCurrent: { type: Number, default: 0 },
    syncProgressTotal: { type: Number, default: 0 },
    syncCurrentTicker: { type: String, default: '', trim: true },
    syncCurrentCompanyName: { type: String, default: '', trim: true }
  },
  { timestamps: true }
);

WatchlistSchema.index({ ownerUsername: 1, source: 1, sourceWatchlistId: 1 }, { unique: true });

export const getWatchlistModel = (connection) =>
  connection.models.Watchlist || connection.model('Watchlist', WatchlistSchema);
