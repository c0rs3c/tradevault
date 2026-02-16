import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import TradeForm from '../components/TradeForm';
import { createTrade } from '../api/trades';
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
    try {
      await createTrade(values);
      router.push('/trades');
    } catch (error) {
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
