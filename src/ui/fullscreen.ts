// Fullscreen helpers. Safari (incl. iPad) still only has the webkit-prefixed API; iPhone has none for pages.

type WebkitDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => void };

export function fullscreenSupported(): boolean {
  const el = document.documentElement as WebkitElement;
  return !!(el.requestFullscreen || el.webkitRequestFullscreen);
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
    void el.requestFullscreen().catch(() => {});
  } else {
    el.webkitRequestFullscreen?.();
  }
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
