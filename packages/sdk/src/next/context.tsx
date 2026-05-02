'use client';

import { createContext, useContext, useRef, type ReactNode } from 'react';

import { createBrowserTracker, type BrowserTracker, type BrowserTrackerConfig } from '../browser/index.js';

const TrackbridgeReactContext = createContext<BrowserTracker | null>(null);

export type TrackbridgeContextProviderProps = {
  config: BrowserTrackerConfig;
  children: ReactNode;
};

export function TrackbridgeContextProvider({
  config,
  children,
}: TrackbridgeContextProviderProps): ReactNode {
  const trackerRef = useRef<BrowserTracker | null>(null);
  if (trackerRef.current === null) {
    trackerRef.current = createBrowserTracker(config);
  }
  return (
    <TrackbridgeReactContext.Provider value={trackerRef.current}>
      {children}
    </TrackbridgeReactContext.Provider>
  );
}

export function useTracker(): BrowserTracker {
  const tracker = useContext(TrackbridgeReactContext);
  if (tracker === null) {
    throw new Error('useTracker must be called inside <TrackbridgeProvider>');
  }
  return tracker;
}
