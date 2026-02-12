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
    },
    chartSettings: {
      defaultTimeframe: {
        type: String,
        enum: ['30m', '1h', '1D', '1W'],
        default: '1D'
      },
      smaPeriods: {
        type: [Number],
        default: [10, 20, 50]
      },
      smaColors: {
        type: [String],
        default: ['#2563eb', '#f59e0b', '#16a34a']
      },
      smaLineWidth: {
        type: String,
        enum: ['thin', 'medium', 'thick'],
        default: 'thin'
      },
      markerSettings: {
        entryArrowColor: { type: String, default: '#000000' },
        exitArrowColor: { type: String, default: '#2563eb' },
        entryArrowSize: { type: Number, default: 1 },
        exitArrowSize: { type: Number, default: 1 },
        entryLabelColor: { type: String, default: '#000000' },
        exitLabelColor: { type: String, default: '#000000' },
        labelFontFamily: { type: String, default: 'Trebuchet MS, Roboto, sans-serif' },
        labelFontSize: { type: Number, default: 12 }
      }
    }
  },
  { timestamps: true }
);

export default mongoose.models.Settings || mongoose.model('Settings', SettingsSchema);
