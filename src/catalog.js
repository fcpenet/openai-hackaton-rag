import { TtlCache } from "./cache.js";

const memory = new TtlCache();
const DAY = 24 * 60 * 60_000;

export class Catalog {
  constructor({ redisUrl = process.env.CATALOG_REDIS_REST_URL, redisToken = process.env.CATALOG_REDIS_REST_TOKEN, fetchImpl = fetch } = {}) {
    this.redisUrl = redisUrl?.replace(/\/$/, "");
    this.redisToken = redisToken;
    this.fetch = fetchImpl;
  }

  async get(query) {
    const key = this.#key(query);
    if (!this.redisUrl || !this.redisToken) return memory.get(key);
    const response = await this.fetch(`${this.redisUrl}/get/${encodeURIComponent(key)}`, {
      headers: { authorization: `Bearer ${this.redisToken}` }
    });
    if (!response.ok) throw new Error(`Catalog store read failed (${response.status})`);
    const { result } = await response.json();
    return result ? JSON.parse(result) : undefined;
  }

  async set(query, products) {
    const key = this.#key(query);
    if (!this.redisUrl || !this.redisToken) return memory.set(key, products, 30 * DAY);
    const value = encodeURIComponent(JSON.stringify(products));
    const response = await this.fetch(`${this.redisUrl}/set/${encodeURIComponent(key)}/${value}?EX=${30 * 24 * 60 * 60}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.redisToken}` }
    });
    if (!response.ok) throw new Error(`Catalog store write failed (${response.status})`);
  }

  #key(query) {
    return `products:v1:${query.trim().toLowerCase().replace(/\s+/g, " ")}`;
  }
}
