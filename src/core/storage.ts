/** localStorage, or null where it's unavailable (private mode, sandboxed previews). */
export function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
