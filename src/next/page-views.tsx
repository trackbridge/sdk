'use client';

import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { useTracker } from './context.js';

export function TrackbridgePageViews(): ReactNode {
  const tracker = useTracker();
  const pathname = usePathname();

  useEffect(() => {
    tracker.trackPageView({ path: pathname });
  }, [tracker, pathname]);

  return null;
}
