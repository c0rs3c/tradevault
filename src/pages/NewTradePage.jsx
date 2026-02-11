import { useState } from 'react';
import { useRouter } from 'next/navigation';
import TradeForm from '../components/TradeForm';
import { createTrade } from '../api/trades';

const NewTradePage = () => {
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

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
      <TradeForm onSubmit={handleSubmit} submitting={submitting} />
    </div>
  );
};

export default NewTradePage;
