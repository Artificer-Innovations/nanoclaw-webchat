import { vi } from 'vitest';

class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

export const memoryLocalStorage = new MemoryStorage();
export const memorySessionStorage = new MemoryStorage();

const throwingStorageGet: Storage = {
  getItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
  key: () => null,
  length: 0,
};

const throwingStorageSet: Storage = {
  getItem: () => null,
  setItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
  removeItem: () => undefined,
  clear: () => undefined,
  key: () => null,
  length: 0,
};

export function installMemoryStorage(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value: memoryLocalStorage,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: memorySessionStorage,
    configurable: true,
    writable: true,
  });
}

export function withThrowingStorageGet(run: () => void): void {
  vi.stubGlobal('localStorage', throwingStorageGet);
  try {
    run();
  } finally {
    installMemoryStorage();
    memoryLocalStorage.clear();
  }
}

export function withThrowingStorageSet(run: () => void): void {
  vi.stubGlobal('localStorage', throwingStorageSet);
  try {
    run();
  } finally {
    installMemoryStorage();
    memoryLocalStorage.clear();
  }
}
