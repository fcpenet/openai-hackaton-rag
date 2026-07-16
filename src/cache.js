export class TtlCache {
  #values = new Map();

  get(key) {
    const entry = this.#values.get(key);
    if (!entry || entry.expiresAt <= Date.now()) {
      this.#values.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value, ttlMs) {
    this.#values.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}
