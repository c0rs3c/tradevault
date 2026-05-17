import { Suspense } from 'react';
import EarningsShareholdingDeepDivePage from '@/pages/EarningsShareholdingDeepDivePage';

export default function EarningsDataRoute() {
  return (
    <Suspense fallback={null}>
      <EarningsShareholdingDeepDivePage mode="tools" />
    </Suspense>
  );
}
