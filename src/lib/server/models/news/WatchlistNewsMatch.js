import mongoose from 'mongoose';

const WatchlistNewsMatchSchema = new mongoose.Schema(
  {
    ownerUsername: { type: String, required: true, index: true },
    watchlistId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    canonicalTicker: { type: String, required: true, trim: true },
    symbol: { type: String, required: true, trim: true },
    companyName: { type: String, default: '', trim: true },
    articleId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    matchedBy: { type: String, enum: ['symbol', 'companyName', 'both'], required: true },
    matchedQuery: { type: String, required: true, trim: true },
    publishedAt: { type: Date, required: true },
    syncedAt: { type: Date, required: true }
  },
  { timestamps: true }
);

WatchlistNewsMatchSchema.index({ watchlistId: 1, canonicalTicker: 1, articleId: 1 }, { unique: true });

export const getWatchlistNewsMatchModel = (connection) =>
  connection.models.WatchlistNewsMatch || connection.model('WatchlistNewsMatch', WatchlistNewsMatchSchema);
