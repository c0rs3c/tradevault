import mongoose from 'mongoose';

const SettingsSchema = new mongoose.Schema(
  {
    totalCapital: { type: Number, default: 0, min: 0 },
    defaultRiskPercent: { type: Number, default: null, min: 0 },
    theme: { type: String, enum: ['light', 'dark'], default: 'dark' },
    accentColor: {
      type: String,
      enum: ['emerald', 'sky', 'rose', 'amber', 'violet'],
      default: 'emerald'
    }
  },
  { timestamps: true }
);

export default mongoose.models.Settings || mongoose.model('Settings', SettingsSchema);
