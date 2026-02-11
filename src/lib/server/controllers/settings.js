import Settings from '../models/Settings';
import { clearTradeReadCaches } from './trades';

const getOrCreateSettings = async () => {
  let settings = await Settings.findOne();
  if (!settings) {
    settings = await Settings.create({ totalCapital: 0, theme: 'dark', accentColor: 'emerald' });
    return settings;
  }
  let updated = false;
  if (!settings.theme) {
    settings.theme = 'dark';
    updated = true;
  }
  if (!settings.accentColor) {
    settings.accentColor = 'emerald';
    updated = true;
  }
  if (updated) await settings.save();
  return settings;
};

export const getSettings = async () => {
  return getOrCreateSettings();
};

export const updateSettings = async (payload) => {
  const settings = await getOrCreateSettings();
  const { totalCapital, defaultRiskPercent, theme, accentColor } = payload;

  if (totalCapital !== undefined) settings.totalCapital = totalCapital;
  if (defaultRiskPercent !== undefined) settings.defaultRiskPercent = defaultRiskPercent;
  if (theme !== undefined) settings.theme = theme;
  if (accentColor !== undefined) settings.accentColor = accentColor;

  await settings.save();
  clearTradeReadCaches();
  return settings;
};
