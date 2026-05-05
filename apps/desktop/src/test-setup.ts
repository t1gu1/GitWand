/**
 * Vitest global setup — replaces the Node.js v25 built-in `localStorage` stub
 * with a proper in-memory Web Storage implementation.
 *
 * Node.js v25 ships a `localStorage` global that only works when
 * `--localstorage-file` is supplied. Without the flag the object exists but has
 * no Storage methods (setItem/getItem/removeItem/clear/key/length).
 * Vitest's jsdom environment does not override this built-in, so tests that rely
 * on localStorage fail. This setup file installs a spec-compliant in-memory
 * replacement on `globalThis` before every test file runs.
 */

class InMemoryStorage implements Storage {
  private store: Map<string, string> = new Map();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

// Replace the Node.js v25 built-in stub with a real in-memory implementation.
Object.defineProperty(globalThis, "localStorage", {
  value: new InMemoryStorage(),
  writable: true,
  configurable: true,
});

Object.defineProperty(globalThis, "sessionStorage", {
  value: new InMemoryStorage(),
  writable: true,
  configurable: true,
});
