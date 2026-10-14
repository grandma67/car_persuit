// Fullscreen helpers. Safari (incl. iPad) still only has the webkit-prefixed API; iPhone has none for pages.

import { isTouchDevice } from './TouchControls';

type WebkitDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => void };
type LockableOrientation = ScreenOrientation & { lock?: (orientation: 'landscape') => Promise<void> };

/**
 * Launched as an installed PWA: already fullscreen (and landscape) by the manifest, so there's nothing
 * to toggle. Checked once at load, since a browser tab also reports display-mode fullscreen after
 * requestFullscreen, which would hide the button needed to leave it.
 */
const installedApp =
  !!(navigator as Navigator & { standalone?: boolean }).standalone || // older iOS home-screen apps
  ['fullscreen', 'standalone'].some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches);

export function fullscreenSupported(): boolean {
  const el = document.documentElement as WebkitElement;
  return !!(el.requestFullscreen || el.webkitRequestFullscreen) && !installedApp;
}

export function isFullscreen(): boolean {
  const doc = document as WebkitDocument;
  return !!(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

/** Enter/leave fullscreen. Call from a user gesture (key press or click) so browsers allow it. */
export function toggleFullscreen(): void {
  const doc = document as WebkitDocument;
  const el = document.documentElement as WebkitElement;
  if (isFullscreen()) {
    if (doc.exitFullscreen) void doc.exitFullscreen().catch(() => {});
    else doc.webkitExitFullscreen?.();
  } else if (el.requestFullscreen) {
    void el.requestFullscreen().then(lockLandscape, () => {});
  } else {
    el.webkitRequestFullscreen?.();
  }
}

/** On phones, turn sideways like the installed app does. Only allowed while fullscreen; unsupported on iOS. */
function lockLandscape(): void {
  if (!isTouchDevice()) return;
  const orientation = screen.orientation as LockableOrientation | undefined;
  void orientation?.lock?.('landscape').catch(() => {});
}

/** Calls fn whenever fullscreen is entered or left; returns an unsubscribe. */
export function onFullscreenChange(fn: () => void): () => void {
  document.addEventListener('fullscreenchange', fn);
  document.addEventListener('webkitfullscreenchange', fn);
  return () => {
    document.removeEventListener('fullscreenchange', fn);
    document.removeEventListener('webkitfullscreenchange', fn);
  };
}
