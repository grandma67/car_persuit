import { describe, expect, it } from 'vitest';
import { wantsHomeScreenHint } from './homeScreenHint';

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.0.0 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
};

describe('home screen hint', () => {
  it('iPhone in Safari or Chrome, not installed, no fullscreen API: shown', () => {
    expect(wantsHomeScreenHint({ userAgent: UA.iphoneSafari, fullscreen: false, installed: false })).toBe(true);
    expect(wantsHomeScreenHint({ userAgent: UA.iphoneChrome, fullscreen: false, installed: false })).toBe(true);
  });

  it('already a home-screen app, or the API exists (a future iOS): hidden', () => {
    expect(wantsHomeScreenHint({ userAgent: UA.iphoneChrome, fullscreen: false, installed: true })).toBe(false);
    expect(wantsHomeScreenHint({ userAgent: UA.iphoneChrome, fullscreen: true, installed: false })).toBe(false);
  });

  it('iPad and Android never get it (they have the button)', () => {
    expect(wantsHomeScreenHint({ userAgent: UA.ipad, fullscreen: false, installed: false })).toBe(false);
    expect(wantsHomeScreenHint({ userAgent: UA.android, fullscreen: false, installed: false })).toBe(false);
  });
});
