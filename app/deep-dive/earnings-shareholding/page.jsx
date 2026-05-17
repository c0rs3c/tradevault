import { Suspense } from 'react';
import EarningsShareholdingDeepDivePage from '@/pages/EarningsShareholdingDeepDivePage';

export default function EarningsShareholdingDeepDiveRoute() {
  return (
    <Suspense fallback={null}>
      <EarningsShareholdingDeepDivePage mode="screener" />
    </Suspense>
  );
}
