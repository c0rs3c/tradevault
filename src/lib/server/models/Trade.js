import mongoose from 'mongoose';

const PyramidSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    price: { type: Number, required: true, min: 0.000001 },
    qty: { type: Number, required: true, min: 0.000001 },
    stopLoss: { type: Number, required: true, min: 0.000001 }
  },
  { _id: true }
);

const ExitSchema = new mongoose.Schema(
  {
    exitDate: { type: Date, required: true },
    exitPrice: { type: Number, required: true, min: 0.000001 },
    exitQty: { type: Number, required: true, min: 0.000001 },
    notes: { type: String, trim: true }
  },
  { _id: true }
);

const StopLossAdjustmentSchema = new mongoose.Schema(
  {
    date: { type: Date, default: Date.now },
    qty: { type: Number, required: true, min: 0.000001 },
    stopLoss: { type: Number, required: true, min: 0.000001 }
  },
  { _id: true }
);

const TradeSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true, trim: true, uppercase: true },
    side: { type: String, enum: ['LONG', 'SHORT'], default: 'LONG' },
    entryDate: { type: Date, required: true },
    entryPrice: { type: Number, required: true, min: 0.000001 },
    entryQty: { type: Number, required: true, min: 0.000001 },
    stopLoss: { type: Number, required: true, min: 0.000001 },
    pyramids: [PyramidSchema],
    stopLossAdjustments: [StopLossAdjustmentSchema],
    exits: [ExitSchema],
    lastPrice: { type: Number },
    charges: { type: Number, default: 0 },
    brokerGrossPnL: { type: Number },
    brokerNetPnL: { type: Number },
    notes: { type: String, trim: true },
    tags: [{ type: String, trim: true }],
    strategy: { type: String, trim: true },
    screenshot: { type: String, trim: true },
    importBatchId: { type: mongoose.Schema.Types.ObjectId, ref: 'ImportBatch', index: true }
  },
  { timestamps: true }
);

export default mongoose.models.Trade || mongoose.model('Trade', TradeSchema);
