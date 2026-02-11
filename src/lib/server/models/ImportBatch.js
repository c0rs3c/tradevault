import mongoose from 'mongoose';

const ImportPreviewRowSchema = new mongoose.Schema(
  {
    symbol: { type: String, trim: true, uppercase: true },
    side: { type: String, trim: true, uppercase: true },
    dateText: { type: String, trim: true },
    qty: { type: String, trim: true },
    price: { type: String, trim: true },
    status: { type: String, trim: true, uppercase: true }
  },
  { _id: false }
);

const ImportBatchSchema = new mongoose.Schema(
  {
    source: { type: String, required: true, trim: true, uppercase: true, default: 'ZERODHA' },
    fileName: { type: String, trim: true },
    importedCount: { type: Number, required: true, min: 0, default: 0 },
    previewRows: { type: [ImportPreviewRowSchema], default: [] }
  },
  { timestamps: true }
);

export default mongoose.models.ImportBatch || mongoose.model('ImportBatch', ImportBatchSchema);
