// localStorage can throw: private browsing, storage disabled, quota full,
// or a sandboxed iframe. Every read and write goes through these two helpers,
// so a storage failure never crashes an app. The worst case is "nothing saved".

const PREFIX = "pd-games:";

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Returns false if the value could not be saved, so the UI can say so. */
export function save<T>(key: string, value: T): boolean {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function makeId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
