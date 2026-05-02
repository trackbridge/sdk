// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

// Stub next/script so the provider can be rendered in tests without
// pulling in Next's full runtime. We capture the props each <Script />
// receives so we can assert on them.
const scriptCalls: Array<Record<string, unknown>> = [];
vi.mock('next/script', () => ({
  default: (props: Record<string, unknown>) => {
    scriptCalls.push(props);
    // Render as a plain <script> tag so the test environment can see
    // the inline source. Strategy is preserved as a data attribute
    // for assertions.
    const { children, src, id, strategy, ...rest } = props as {
      children?: string;
      src?: string;
      id?: string;
      strategy?: string;
    };
    return (
      <script
        data-id={id}
        data-strategy={strategy}
        src={src}
        {...rest}
        dangerouslySetInnerHTML={children !== undefined ? { __html: children } : undefined}
      />
    );
  },
}));

import { TrackbridgeProvider } from './provider.js';

const minimalConfig = {
  adsConversionId: 'AW-TEST',
  ga4MeasurementId: 'G-TEST',
} as const;

describe('TrackbridgeProvider', () => {
  test('emits the Consent Mode v2 default-denied snippet with strategy beforeInteractive', () => {
    scriptCalls.length = 0;
    render(
      <TrackbridgeProvider config={minimalConfig}>
        <div>child</div>
      </TrackbridgeProvider>,
    );
    const consentScript = scriptCalls.find((c) => c.id === 'tb-consent');
    expect(consentScript).toBeDefined();
    expect(consentScript!.strategy).toBe('beforeInteractive');
    const inline = String(consentScript!.children);
    expect(inline).toContain("gtag('consent', 'default'");
    expect(inline).toContain('"ad_storage":"denied"');
    expect(inline).toContain('"ad_user_data":"denied"');
    expect(inline).toContain('"ad_personalization":"denied"');
    expect(inline).toContain('"analytics_storage":"denied"');
  });

  test('merges consentDefaults override per field', () => {
    scriptCalls.length = 0;
    render(
      <TrackbridgeProvider
        config={minimalConfig}
        consentDefaults={{ analytics_storage: 'granted' }}
      >
        <div>child</div>
      </TrackbridgeProvider>,
    );
    const consentScript = scriptCalls.find((c) => c.id === 'tb-consent');
    const inline = String(consentScript!.children);
    expect(inline).toContain('"ad_storage":"denied"');
    expect(inline).toContain('"analytics_storage":"granted"');
  });

  test('emits the gtag.js loader pointing at the Ads ID with strategy afterInteractive', () => {
    scriptCalls.length = 0;
    render(
      <TrackbridgeProvider config={minimalConfig}>
        <div>child</div>
      </TrackbridgeProvider>,
    );
    const loaderScript = scriptCalls.find(
      (c) => typeof c.src === 'string' && (c.src as string).includes('googletagmanager.com/gtag/js'),
    );
    expect(loaderScript).toBeDefined();
    expect(loaderScript!.src).toBe('https://www.googletagmanager.com/gtag/js?id=AW-TEST');
    expect(loaderScript!.strategy).toBe('afterInteractive');
  });

  test('renders children inside the context so useTracker works', async () => {
    scriptCalls.length = 0;
    const { useTracker } = await import('./context.js');
    let captured: ReturnType<typeof useTracker> | null = null;
    function Consumer() {
      captured = useTracker();
      return null;
    }
    render(
      <TrackbridgeProvider config={minimalConfig}>
        <Consumer />
      </TrackbridgeProvider>,
    );
    expect(captured).not.toBeNull();
    expect(typeof captured!.trackConversion).toBe('function');
  });
});
