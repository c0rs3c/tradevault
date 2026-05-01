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
    dashboardCards: {
      totalRealizedPnl: { type: Boolean, default: true },
      monthlyPnl: { type: Boolean, default: true },
      totalCapitalAtRisk: { type: Boolean, default: true },
      totalPositionSize: { type: Boolean, default: true },
      totalUnrealizedPnl: { type: Boolean, default: true },
      avgR: { type: Boolean, default: false },
      avgHoldingDays: { type: Boolean, default: true },
      winRate: { type: Boolean, default: true },
      avgWinnerLoser: { type: Boolean, default: true },
      profitFactor: { type: Boolean, default: false },
      maxDrawdown: { type: Boolean, default: false },
      tradesOpenCount: { type: Boolean, default: true }
    },
    dashboardExcludedOpenPositions: {
      type: [String],
      default: []
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
      smaScaleLabelsVisible: {
        type: Boolean,
        default: false
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
      },
      purpleDotVolumeSettings: {
        visible: { type: Boolean, default: true },
        leftPaneVisible: { type: Boolean, default: true },
        rightPaneVisible: { type: Boolean, default: true },
        combineConditions: { type: Boolean, default: true },
        volumeAbove: { type: Number, default: 1000000, min: 0 },
        percentThreshold: { type: Number, default: 5, min: 0 },
        color: { type: String, default: '#a855f7' },
        size: { type: Number, default: 1, min: 0.5, max: 3 },
        position: { type: String, enum: ['aboveBar', 'belowBar'], default: 'belowBar' }
      }
    }
  },
  { timestamps: true }
);

export default mongoose.models.Settings || mongoose.model('Settings', SettingsSchema);
