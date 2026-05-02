// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { createContext, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Stub next/navigation's usePathname so the test can drive the value.
let mockPathname = '/';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

// Stub the context so we can inject a tracker spy without going through
// TrackbridgeProvider (which pulls in next/script and createBrowserTracker).
type TrackPageViewSpy = ReturnType<typeof vi.fn>;
const TrackerCtx = createContext<{ trackPageView: TrackPageViewSpy } | null>(null);

vi.mock('./context.js', async () => {
  const actual = await vi.importActual<typeof import('./context.js')>('./context.js');
  return {
    ...actual,
    useTracker: () => {
      const tracker = (globalThis as { __spyTracker?: { trackPageView: TrackPageViewSpy } })
        .__spyTracker;
      if (!tracker) throw new Error('spy tracker not set');
      return tracker as unknown as ReturnType<typeof actual.useTracker>;
    },
  };
});

import { TrackbridgePageViews } from './page-views.js';

let spy: TrackPageViewSpy;

beforeEach(() => {
  spy = vi.fn();
  (globalThis as { __spyTracker?: { trackPageView: TrackPageViewSpy } }).__spyTracker = {
    trackPageView: spy,
  };
  mockPathname = '/';
});

afterEach(() => {
  delete (globalThis as { __spyTracker?: unknown }).__spyTracker;
});

describe('TrackbridgePageViews', () => {
  test('fires trackPageView on initial mount with the current pathname', () => {
    mockPathname = '/products';
    render(<TrackbridgePageViews />);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ path: '/products' });
  });

  test('fires again when pathname changes', () => {
    mockPathname = '/';
    const { rerender } = render(<TrackbridgePageViews />);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith({ path: '/' });

    mockPathname = '/checkout';
    rerender(<TrackbridgePageViews />);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith({ path: '/checkout' });
  });

  test('does not fire again when re-rendered with the same pathname', () => {
    mockPathname = '/about';
    const { rerender } = render(<TrackbridgePageViews />);
    rerender(<TrackbridgePageViews />);
    rerender(<TrackbridgePageViews />);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('returns null (renders nothing)', () => {
    mockPathname = '/';
    const { container } = render(<TrackbridgePageViews />);
    expect(container.innerHTML).toBe('');
  });
});
