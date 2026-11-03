// Whether to tell an iPhone player how to play full-window. iPhone browsers (Chrome included: it is
// WebKit there) have no fullscreen API for pages, only for <video>, so the Fullscreen button is
// hidden; a home-screen web app is the only way to lose the browser bars. Pure, for the test.

export interface HintEnv {
  userAgent: string;
  /** The page can go fullscreen (`fullscreenSupported()`); then the button shows instead. */
  fullscreen: boolean;
  /** Already launched from the home screen. */
  installed: boolean;
}

export const HOME_SCREEN_HINT = 'Fullscreen on iPhone: Share → Add to Home Screen, with “Open as Web App” on.';

/** iPhone or iPod only: iPad has the prefixed API (the button), and other phones have the real one. */
export function wantsHomeScreenHint({ userAgent, fullscreen, installed }: HintEnv): boolean {
  return /\biP(hone|od)\b/.test(userAgent) && !fullscreen && !installed;
}
