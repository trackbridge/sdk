import { describe, expect, test, vi } from 'vitest';

import { defineServerTracker } from './define-server-tracker.js';

describe('defineServerTracker', () => {
  test('invokes the config function on first call and returns a tracker', () => {
    const configFn = vi.fn(() => ({
      ga4MeasurementId: 'G-TEST',
      ga4ApiSecret: 'secret',
    }));
    const get = defineServerTracker(configFn);
    const tracker = get();
    expect(configFn).toHaveBeenCalledTimes(1);
    expect(typeof tracker.trackConversion).toBe('function');
    expect(typeof tracker.trackEvent).toBe('function');
    expect(typeof tracker.fromContext).toBe('function');
  });

  test('caches the tracker — second call returns the same instance without re-invoking the factory', () => {
    const configFn = vi.fn(() => ({
      ga4MeasurementId: 'G-TEST',
      ga4ApiSecret: 'secret',
    }));
    const get = defineServerTracker(configFn);
    const first = get();
    const second = get();
    expect(configFn).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  test('caches the error — failing factory throws on first call and re-throws on subsequent calls without re-invoking', () => {
    const failure = new Error('config-broken');
    const configFn = vi.fn(() => {
      throw failure;
    });
    const get = defineServerTracker(configFn);
    expect(() => get()).toThrow('config-broken');
    expect(() => get()).toThrow('config-broken');
    expect(configFn).toHaveBeenCalledTimes(1);
  });

  test('non-Error throws are wrapped in an Error before caching', () => {
    let calls = 0;
    const configFn = vi.fn(() => {
      calls += 1;
      throw 'string-thrown';
    });
    const get = defineServerTracker(configFn);
    expect(() => get()).toThrow('string-thrown');
    expect(() => get()).toThrow('string-thrown');
    expect(calls).toBe(1);
  });
});
