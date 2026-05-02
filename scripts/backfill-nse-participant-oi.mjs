import mongoose from 'mongoose';
import {
  DEFAULT_BACKFILL_END_DATE,
  DEFAULT_BACKFILL_START_DATE,
  getTradingDatesWithinRange,
  syncParticipantOiForDates
} from '../src/lib/server/services/nseParticipantOi.js';

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('Missing MONGO_URI environment variable');
  process.exit(1);
}

const run = async () => {
  await mongoose.connect(MONGO_URI);

  const dates = getTradingDatesWithinRange(DEFAULT_BACKFILL_START_DATE, DEFAULT_BACKFILL_END_DATE);
  const result = await syncParticipantOiForDates(dates);

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(error.message || String(error));
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
