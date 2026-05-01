// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { TrackbridgeContextProvider, useTracker } from './context.js';
import type { BrowserTrackerConfig } from '../browser/index.js';

const minimalConfig: BrowserTrackerConfig = {
  adsConversionId: 'AW-TEST',
  ga4MeasurementId: 'G-TEST',
};

describe('useTracker', () => {
  test('throws a clear error when called outside <TrackbridgeContextProvider>', () => {
    function Consumer() {
      useTracker();
      return null;
    }
    expect(() => render(<Consumer />)).toThrow(
      /useTracker must be called inside <TrackbridgeProvider>/,
    );
  });

  test('returns the tracker created by the provider', () => {
    let captured: ReturnType<typeof useTracker> | null = null;
    function Consumer() {
      captured = useTracker();
      return null;
    }
    render(
      <TrackbridgeContextProvider config={minimalConfig}>
        <Consumer />
      </TrackbridgeContextProvider>,
    );
    expect(captured).not.toBeNull();
    expect(typeof captured!.trackConversion).toBe('function');
    expect(typeof captured!.trackPageView).toBe('function');
    expect(typeof captured!.exportContext).toBe('function');
  });

  test('returns the same tracker instance across re-renders of the consumer', () => {
    const seen: ReturnType<typeof useTracker>[] = [];
    function Consumer() {
      seen.push(useTracker());
      return null;
    }
    const { rerender } = render(
      <TrackbridgeContextProvider config={minimalConfig}>
        <Consumer />
      </TrackbridgeContextProvider>,
    );
    rerender(
      <TrackbridgeContextProvider config={minimalConfig}>
        <Consumer />
      </TrackbridgeContextProvider>,
    );
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });
});
