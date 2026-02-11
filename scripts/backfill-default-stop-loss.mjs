import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URI;
const DEFAULT_STOP_LOSS_PCT = 0.03;

if (!MONGO_URI) {
  console.error('Missing MONGO_URI environment variable');
  process.exit(1);
}

const computeDefaultStopLoss = ({ entryPrice, side }) => {
  const price = Number(entryPrice || 0);
  if (price <= 0) return 0;
  const isShort = String(side || 'LONG').toUpperCase() === 'SHORT';
  const multiplier = isShort ? 1 + DEFAULT_STOP_LOSS_PCT : 1 - DEFAULT_STOP_LOSS_PCT;
  return Number((price * multiplier).toFixed(4));
};

const run = async () => {
  await mongoose.connect(MONGO_URI);
  const collection = mongoose.connection.collection('trades');

  const cursor = collection.find({
    $or: [
      { stopLoss: { $exists: false } },
      { stopLoss: null },
      { stopLoss: { $lte: 0 } },
      { importBatchId: { $exists: true } }
    ]
  });

  let scanned = 0;
  let updated = 0;

  // eslint-disable-next-line no-restricted-syntax
  for await (const trade of cursor) {
    scanned += 1;
    const currentStopLoss = Number(trade.stopLoss || 0);
    const isMissingOrInvalid = !currentStopLoss || currentStopLoss <= 0;
    const isLegacyImportDefault =
      trade.importBatchId &&
      Number(trade.entryPrice || 0) > 0 &&
      Math.abs(currentStopLoss - Number(trade.entryPrice)) < 1e-8;

    if (!isMissingOrInvalid && !isLegacyImportDefault) continue;

    const stopLoss = computeDefaultStopLoss({
      entryPrice: trade.entryPrice,
      side: trade.side
    });
    if (stopLoss <= 0) continue;

    await collection.updateOne(
      { _id: trade._id },
      { $set: { stopLoss, updatedAt: new Date() } }
    );
    updated += 1;
  }

  console.log(`Backfill complete. scanned=${scanned}, updated=${updated}`);
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(error.message || String(error));
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
