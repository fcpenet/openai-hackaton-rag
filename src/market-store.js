import { createClient } from "@libsql/client";
import { simulateMarket } from "./market-economy.js";

export const marketSetupSql = `
  CREATE TABLE IF NOT EXISTS market_snapshots (
    product_id TEXT NOT NULL,
    market_day TEXT NOT NULL,
    inventory INTEGER NOT NULL,
    units_sold INTEGER NOT NULL,
    sales_velocity INTEGER NOT NULL,
    demand_score INTEGER NOT NULL,
    featured_score INTEGER NOT NULL,
    trend TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (product_id, market_day)
  )
`;

export class MarketStore {
  constructor({ client } = {}) {
    this.client = client || this.#createClient();
    this.setup = null;
  }

  async getMarket(product, { now = new Date() } = {}) {
    const baseline = simulateMarket(product, { now });
    await this.#ensureSetup();
    const existing = await this.client.execute({
      sql: `SELECT inventory, units_sold, sales_velocity, demand_score, featured_score, trend
            FROM market_snapshots WHERE product_id = ? AND market_day = ?`,
      args: [product.id, baseline.day]
    });
    if (existing.rows[0]) return { day: baseline.day, ...this.#fromRow(existing.rows[0], baseline) };

    const timestamp = now.toISOString();
    await this.client.execute({
      sql: `INSERT INTO market_snapshots
            (product_id, market_day, inventory, units_sold, sales_velocity, demand_score, featured_score, trend, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(product_id, market_day) DO NOTHING`,
      args: [product.id, baseline.day, baseline.inventory, baseline.unitsSold, baseline.salesVelocity, baseline.demandScore, baseline.featuredScore, baseline.trend, timestamp, timestamp]
    });
    const snapshot = await this.client.execute({
      sql: `SELECT inventory, units_sold, sales_velocity, demand_score, featured_score, trend
            FROM market_snapshots WHERE product_id = ? AND market_day = ?`,
      args: [product.id, baseline.day]
    });
    return { day: baseline.day, ...this.#fromRow(snapshot.rows[0], baseline) };
  }

  #fromRow(row, baseline) {
    return {
      source: Number(row.units_sold) > baseline.unitsSold ? "observed" : "seeded",
      inventory: Number(row.inventory),
      unitsSold: Number(row.units_sold),
      salesVelocity: Number(row.sales_velocity),
      demandScore: Number(row.demand_score),
      featuredScore: Number(row.featured_score),
      trend: row.trend
    };
  }

  #createClient() {
    const { TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: authToken } = process.env;
    if (!url || !authToken) throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be configured");
    return createClient({ url, authToken });
  }

  async #ensureSetup() {
    if (!this.setup) this.setup = this.client.execute(marketSetupSql);
    await this.setup;
  }
}
