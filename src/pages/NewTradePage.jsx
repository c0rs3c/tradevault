import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import TradeForm from '../components/TradeForm';
import { createTrade, deleteTradeScreenshotUpload, uploadTradeScreenshotFile } from '../api/trades';
import { fetchSymbols } from '../api/symbols';

const NewTradePage = () => {
  const [submitting, setSubmitting] = useState(false);
  const [symbolOptions, setSymbolOptions] = useState([]);
  const router = useRouter();

  useEffect(() => {
    const loadSymbols = async () => {
      try {
        const data = await fetchSymbols();
        setSymbolOptions(Array.isArray(data?.symbols) ? data.symbols : []);
      } catch {
        setSymbolOptions([]);
      }
    };
    loadSymbols();
  }, []);

  const handleSubmit = async (values) => {
    setSubmitting(true);
    const uploadedScreenshots = [];
    try {
      const payload = {
        symbol: values.symbol,
        side: values.side,
        entryDate: values.entryDate,
        entryPrice: values.entryPrice,
        entryQty: values.entryQty,
        stopLoss: values.stopLoss,
        strategy: values.strategy,
        notes: values.notes,
        screenshots: values.screenshots || []
      };

      if (Array.isArray(values.screenshotFiles) && values.screenshotFiles.length) {
        for (const file of values.screenshotFiles) {
          const uploaded = await uploadTradeScreenshotFile(file);
          uploadedScreenshots.push(uploaded);
        }
        payload.screenshots = [...payload.screenshots, ...uploadedScreenshots];
      }

      await createTrade(payload);
      router.push('/trades');
    } catch (error) {
      await Promise.all(uploadedScreenshots.map((item) => deleteTradeScreenshotUpload(item.key).catch(() => {})));
      alert(error.response?.data?.message || 'Failed to create trade');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New Trade</h1>
      <TradeForm onSubmit={handleSubmit} submitting={submitting} symbolOptions={symbolOptions} />
    </div>
  );
};

export default NewTradePage;
