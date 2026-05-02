import mongoose from 'mongoose';

const NseParticipantOiSnapshotSchema = new mongoose.Schema(
  {
    tradeDate: { type: Date, required: true, index: true },
    clientType: { type: String, required: true, trim: true, uppercase: true },
    futureIndexLong: { type: Number, default: 0, min: 0 },
    futureIndexShort: { type: Number, default: 0, min: 0 },
    futureStockLong: { type: Number, default: 0, min: 0 },
    futureStockShort: { type: Number, default: 0, min: 0 },
    optionIndexCallLong: { type: Number, default: 0, min: 0 },
    optionIndexPutLong: { type: Number, default: 0, min: 0 },
    optionIndexCallShort: { type: Number, default: 0, min: 0 },
    optionIndexPutShort: { type: Number, default: 0, min: 0 },
    optionStockCallLong: { type: Number, default: 0, min: 0 },
    optionStockPutLong: { type: Number, default: 0, min: 0 },
    optionStockCallShort: { type: Number, default: 0, min: 0 },
    optionStockPutShort: { type: Number, default: 0, min: 0 },
    totalLongContracts: { type: Number, default: 0, min: 0 },
    totalShortContracts: { type: Number, default: 0, min: 0 },
    sourceUrl: { type: String, trim: true },
    downloadedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

NseParticipantOiSnapshotSchema.index({ tradeDate: 1, clientType: 1 }, { unique: true });

export default mongoose.models.NseParticipantOiSnapshot ||
  mongoose.model('NseParticipantOiSnapshot', NseParticipantOiSnapshotSchema);
