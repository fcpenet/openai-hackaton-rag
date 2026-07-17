import { createClient } from "@libsql/client";

const setupSql = `
  CREATE TABLE IF NOT EXISTS product_collections (
    query TEXT PRIMARY KEY,
    products_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`;

export class Catalog {
  constructor({ client } = {}) {
    this.client = client || this.#createClient();
    this.setup = null;
  }

  async get(query) {
    await this.#ensureSetup();
    const result = await this.client.execute({
      sql: "SELECT products_json FROM product_collections WHERE query = ?",
      args: [this.#key(query)]
    });
    return result.rows[0] ? JSON.parse(result.rows[0].products_json) : undefined;
  }

  async set(query, products) {
    await this.#ensureSetup();
    await this.client.execute({
      sql: `INSERT INTO product_collections (query, products_json, created_at)
            VALUES (?, ?, ?)
            ON CONFLICT(query) DO UPDATE SET products_json = excluded.products_json, created_at = excluded.created_at`,
      args: [this.#key(query), JSON.stringify(products), new Date().toISOString()]
    });
  }

  #key(query) {
    return `products:v2:${query.trim().toLowerCase().replace(/\s+/g, " ")}`;
  }

  #createClient() {
    const { TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: authToken } = process.env;
    if (!url || !authToken) throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be configured");
    return createClient({ url, authToken });
  }

  async #ensureSetup() {
    if (!this.setup) this.setup = this.client.execute(setupSql);
    await this.setup;
  }
}
