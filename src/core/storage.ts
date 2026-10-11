/** localStorage, or null where it's unavailable (private mode, sandboxed previews). */
export function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function storageGet(key: string): string | null {
  try {
    return safeStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string): void {
  try {
    safeStorage()?.setItem(key, value);
  } catch {
    // Not persisted; fine.
  }
}
