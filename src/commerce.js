import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";
import { simulateMarket } from "./market-economy.js";
import { marketSetupSql } from "./market-store.js";

const setupSql = [
  `CREATE TABLE IF NOT EXISTS wallet_accounts (
    user_id TEXT PRIMARY KEY,
    balance INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS wallet_ledger (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    amount INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    metadata_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS cart_items (
    user_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    product_json TEXT NOT NULL,
    added_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, item_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL,
    payment_status TEXT NOT NULL,
    total_amount INTEGER NOT NULL,
    currency TEXT NOT NULL,
    item_count INTEGER NOT NULL,
    checkout_source TEXT NOT NULL,
    delivery_schedule_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS order_items (
    order_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price INTEGER NOT NULL,
    product_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (order_id, item_id),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  )`,
  "CREATE INDEX IF NOT EXISTS wallet_ledger_user_created_idx ON wallet_ledger(user_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS cart_items_user_updated_idx ON cart_items(user_id, updated_at DESC)",
  "CREATE INDEX IF NOT EXISTS orders_user_created_idx ON orders(user_id, created_at DESC)",
  marketSetupSql
];

export class CommerceStore {
  constructor({ client } = {}) {
    this.client = client || this.#createClient();
    this.setup = null;
  }

  async getWallet(userId) {
    await this.#ensureSetup();
    await this.#ensureWalletAccount(userId);
    const result = await this.client.execute({
      sql: "SELECT user_id, balance, created_at, updated_at FROM wallet_accounts WHERE user_id = ?",
      args: [userId]
    });
    return result.rows[0] ? this.#walletFromRow(result.rows[0]) : this.#emptyWallet(userId);
  }

  async topUpWallet(userId, amount, metadata = {}) {
    const value = this.#validateAmount(amount, "amount");
    const now = new Date().toISOString();
    return this.#runTransaction(async (db) => {
      await this.#ensureWalletAccount(userId, now, db);
      const current = await this.#readWalletRow(userId, db);
      const balanceAfter = current.balance + value;
      await db.execute({
        sql: "UPDATE wallet_accounts SET balance = ?, updated_at = ? WHERE user_id = ?",
        args: [balanceAfter, now, userId]
      });
      await db.execute({
        sql: "INSERT INTO wallet_ledger (id, user_id, kind, amount, balance_after, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        args: [randomUUID(), userId, "topup", value, balanceAfter, JSON.stringify(metadata), now]
      });
      return this.#walletFromRow({ user_id: userId, balance: balanceAfter, created_at: current.created_at, updated_at: now });
    });
  }

  async listWalletTransactions(userId, limit = 50) {
    await this.#ensureSetup();
    const result = await this.client.execute({
      sql: `SELECT id, kind, amount, balance_after, metadata_json, created_at
            FROM wallet_ledger
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ?`,
      args: [userId, Math.max(1, Math.min(limit, 100))]
    });
    return result.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      amount: row.amount,
      balanceAfter: row.balance_after,
      metadata: JSON.parse(row.metadata_json || "{}"),
      createdAt: row.created_at
    }));
  }

  async getCart(userId) {
    await this.#ensureSetup();
    const result = await this.client.execute({
      sql: `SELECT item_id, quantity, product_json, added_at, updated_at
            FROM cart_items
            WHERE user_id = ?
            ORDER BY updated_at DESC`,
      args: [userId]
    });
    const items = result.rows.map((row) => this.#cartItemFromRow(row));
    return this.#cartSummary(items);
  }

  async addCartItem(userId, input) {
    const { product, quantity } = this.#normalizeCartInput(input);
    const now = new Date().toISOString();
    const itemId = product.id;
    await this.#ensureSetup();
    await this.client.execute({
      sql: `INSERT INTO cart_items (user_id, item_id, quantity, product_json, added_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = excluded.quantity, product_json = excluded.product_json, updated_at = excluded.updated_at`,
      args: [userId, itemId, quantity, JSON.stringify(product), now, now]
    });
    return this.getCart(userId);
  }

  async removeCartItem(userId, itemId) {
    await this.#ensureSetup();
    await this.client.execute({
      sql: "DELETE FROM cart_items WHERE user_id = ? AND item_id = ?",
      args: [userId, itemId]
    });
    return this.getCart(userId);
  }

  async clearCart(userId) {
    await this.#ensureSetup();
    await this.client.execute({ sql: "DELETE FROM cart_items WHERE user_id = ?", args: [userId] });
  }

  async checkout(userId, input = {}) {
    await this.#ensureSetup();
    const source = input.source || (Array.isArray(input.items) && input.items.length ? "direct" : "cart");
    const items = Array.isArray(input.items) && input.items.length ? input.items : (await this.getCart(userId)).items.map((item) => ({ product: item.product, quantity: item.quantity }));
    if (!items.length) {
      const error = new Error("Checkout requires at least one item");
      error.status = 400;
      throw error;
    }

    const normalizedItems = items.map((item) => this.#normalizeCartInput(item));
    const currency = normalizedItems[0].product.price?.currency || "PHP";
    if (normalizedItems.some((entry) => (entry.product.price?.currency || currency) !== currency)) {
      const error = new Error("Checkout items must use the same currency");
      error.status = 400;
      throw error;
    }
    const totalAmount = normalizedItems.reduce((total, entry) => total + (entry.product.price.amount * entry.quantity), 0);
    const itemCount = normalizedItems.reduce((total, entry) => total + entry.quantity, 0);
    const now = new Date();
    const createdAt = now.toISOString();
    const schedule = this.#buildDeliverySchedule(now, itemCount, totalAmount);
    const orderId = randomUUID();

    return this.#runTransaction(async (db) => {
      await this.#ensureWalletAccount(userId, createdAt, db);
      const wallet = await this.#readWalletRow(userId, db);
      if (wallet.balance < totalAmount) {
        const error = new Error("Insufficient wallet balance");
        error.code = "INSUFFICIENT_FUNDS";
        error.status = 402;
        throw error;
      }

      const balanceAfter = wallet.balance - totalAmount;
      await db.execute({
        sql: "UPDATE wallet_accounts SET balance = ?, updated_at = ? WHERE user_id = ?",
        args: [balanceAfter, createdAt, userId]
      });
      await db.execute({
        sql: "INSERT INTO wallet_ledger (id, user_id, kind, amount, balance_after, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        args: [randomUUID(), userId, "checkout", -totalAmount, balanceAfter, JSON.stringify({ orderId, source, itemCount }), createdAt]
      });
      await db.execute({
        sql: `INSERT INTO orders (id, user_id, status, payment_status, total_amount, currency, item_count, checkout_source, delivery_schedule_json, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [orderId, userId, "placed", "paid", totalAmount, currency, itemCount, source, JSON.stringify(schedule), createdAt, createdAt]
      });
      for (const entry of normalizedItems) {
        await db.execute({
          sql: "INSERT INTO order_items (order_id, item_id, quantity, unit_price, product_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          args: [orderId, entry.product.id, entry.quantity, entry.product.price.amount, JSON.stringify(entry.product), createdAt]
        });
        await this.#recordMarketSale(entry.product, entry.quantity, now, db);
      }
      if (source === "cart") {
        await db.execute({ sql: "DELETE FROM cart_items WHERE user_id = ?", args: [userId] });
      }
      return this.getOrder(userId, orderId);
    });
  }

  async #recordMarketSale(product, quantity, now, db = this.client) {
    const baseline = product.market || simulateMarket(product, { now });
    const timestamp = now.toISOString();
    await db.execute({
      sql: `INSERT INTO market_snapshots
            (product_id, market_day, inventory, units_sold, sales_velocity, demand_score, featured_score, trend, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(product_id, market_day) DO NOTHING`,
      args: [product.id, baseline.day, baseline.inventory, baseline.unitsSold, baseline.salesVelocity, baseline.demandScore, baseline.featuredScore, baseline.trend, timestamp, timestamp]
    });
    await db.execute({
      sql: `UPDATE market_snapshots SET
              inventory = MAX(0, inventory - ?),
              units_sold = units_sold + ?,
              sales_velocity = sales_velocity + ?,
              demand_score = demand_score + ?,
              featured_score = featured_score + ?,
              trend = 'rising',
              updated_at = ?
            WHERE product_id = ? AND market_day = ?`,
      args: [quantity, quantity, quantity, quantity * 10, quantity * 6, timestamp, product.id, baseline.day]
    });
  }

  async listOrders(userId, limit = 20) {
    await this.#ensureSetup();
    const result = await this.client.execute({
      sql: `SELECT id, status, payment_status, total_amount, currency, item_count, checkout_source, delivery_schedule_json, created_at, updated_at
            FROM orders
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ?`,
      args: [userId, Math.max(1, Math.min(limit, 100))]
    });
    return result.rows.map((row) => this.#orderFromRow(row));
  }

  async getOrder(userId, orderId) {
    await this.#ensureSetup();
    const orderResult = await this.client.execute({
      sql: `SELECT id, status, payment_status, total_amount, currency, item_count, checkout_source, delivery_schedule_json, created_at, updated_at
            FROM orders
            WHERE user_id = ? AND id = ?`,
      args: [userId, orderId]
    });
    const orderRow = orderResult.rows[0];
    if (!orderRow) return undefined;
    const itemsResult = await this.client.execute({
      sql: `SELECT item_id, quantity, unit_price, product_json, created_at
            FROM order_items
            WHERE order_id = ?
            ORDER BY created_at ASC`,
      args: [orderId]
    });
    return {
      ...this.#orderFromRow(orderRow),
      items: itemsResult.rows.map((row) => ({
        itemId: row.item_id,
        quantity: row.quantity,
        unitPrice: row.unit_price,
        product: JSON.parse(row.product_json || "{}"),
        createdAt: row.created_at
      }))
    };
  }

  async getOrderStatus(userId, orderId) {
    const order = await this.getOrder(userId, orderId);
    if (!order) return undefined;
    const { currentStatus, nextStatus, estimatedDeliveryAt, timeline } = this.#deriveDeliveryStatus(order.deliverySchedule, new Date());
    return {
      orderId: order.id,
      status: currentStatus,
      nextStatus,
      estimatedDeliveryAt,
      timeline,
      paymentStatus: order.paymentStatus,
      totalAmount: order.totalAmount,
      currency: order.currency
    };
  }

  #buildDeliverySchedule(placedAt, itemCount, totalAmount) {
    const addHours = (date, hours) => new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString();
    const addDays = (date, days) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
    const packedHours = 2 + Math.min(itemCount, 6);
    const shippedHours = 12 + Math.min(24, Math.floor(totalAmount / 1500));
    const outHours = shippedHours + 36;
    const deliveredHours = outHours + 36;
    return {
      stages: [
        { status: "placed", at: placedAt.toISOString(), note: "Order received" },
        { status: "packed", at: addHours(placedAt, packedHours), note: "Packed by warehouse" },
        { status: "shipped", at: addHours(placedAt, shippedHours), note: "Handed to carrier" },
        { status: "out_for_delivery", at: addHours(placedAt, outHours), note: "Carrier on route" },
        { status: "delivered", at: addHours(placedAt, deliveredHours), note: "Delivered" }
      ]
    };
  }

  #deriveDeliveryStatus(schedule, now) {
    const timeline = Array.isArray(schedule?.stages) ? schedule.stages : [];
    if (!timeline.length) return { currentStatus: "placed", nextStatus: null, estimatedDeliveryAt: null, timeline: [] };
    let current = timeline[0];
    let next = null;
    for (const stage of timeline) {
      if (new Date(stage.at) <= now) {
        current = stage;
        continue;
      }
      next = stage;
      break;
    }
    return {
      currentStatus: current.status,
      nextStatus: next?.status || null,
      estimatedDeliveryAt: timeline[timeline.length - 1].at,
      timeline
    };
  }

  #orderFromRow(row) {
    const deliverySchedule = JSON.parse(row.delivery_schedule_json || "{\"stages\":[]}");
    const snapshot = this.#deriveDeliveryStatus(deliverySchedule, new Date());
    return {
      id: row.id,
      status: snapshot.currentStatus,
      nextStatus: snapshot.nextStatus,
      estimatedDeliveryAt: snapshot.estimatedDeliveryAt,
      deliverySchedule,
      deliveryTimeline: snapshot.timeline,
      paymentStatus: row.payment_status,
      totalAmount: row.total_amount,
      currency: row.currency,
      itemCount: row.item_count,
      checkoutSource: row.checkout_source,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  #cartSummary(items) {
    const currency = items[0]?.product?.price?.currency || "PHP";
    const totalAmount = items.reduce((total, item) => total + item.product.price.amount * item.quantity, 0);
    return {
      items,
      itemCount: items.reduce((total, item) => total + item.quantity, 0),
      totalAmount,
      currency
    };
  }

  #cartItemFromRow(row) {
    return {
      itemId: row.item_id,
      quantity: row.quantity,
      product: JSON.parse(row.product_json || "{}"),
      addedAt: row.added_at,
      updatedAt: row.updated_at
    };
  }

  #walletFromRow(row) {
    return {
      userId: row.user_id,
      balance: row.balance,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  #emptyWallet(userId) {
    return { userId, balance: 0, createdAt: null, updatedAt: null };
  }

  #normalizeCartInput(input) {
    const product = input?.product || input?.item || input?.productSnapshot || input;
    if (!product || typeof product !== "object") {
      const error = new Error("Cart item must include a product snapshot");
      error.status = 400;
      throw error;
    }
    if (!product.id || !product.title || !product.price || !Number.isInteger(product.price.amount)) {
      const error = new Error("Cart item must include id, title, and price");
      error.status = 400;
      throw error;
    }
    const quantity = this.#validateAmount(input?.quantity ?? 1, "quantity");
    return { product, quantity };
  }

  #validateAmount(value, label) {
    if (!Number.isInteger(value) || value <= 0) {
      const error = new Error(`${label} must be a positive integer`);
      error.status = 400;
      throw error;
    }
    return value;
  }

  async #readWalletRow(userId, db = this.client) {
    const result = await db.execute({
      sql: "SELECT user_id, balance, created_at, updated_at FROM wallet_accounts WHERE user_id = ?",
      args: [userId]
    });
    const row = result.rows[0];
    if (!row) throw new Error("Wallet account missing");
    return row;
  }

  async #ensureWalletAccount(userId, timestamp = new Date().toISOString(), db = this.client) {
    await db.execute({
      sql: `INSERT INTO wallet_accounts (user_id, balance, created_at, updated_at)
            VALUES (?, 0, ?, ?)
            ON CONFLICT(user_id) DO NOTHING`,
      args: [userId, timestamp, timestamp]
    });
  }

  async #runTransaction(work) {
    if (typeof this.client.transaction === "function") {
      const tx = await this.client.transaction("write");
      try {
        const value = await work(tx);
        await tx.commit();
        return value;
      } catch (error) {
        await tx.rollback().catch(() => {});
        throw error;
      }
    }
    return work(this.client);
  }

  #createClient() {
    const { TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: authToken } = process.env;
    if (!url || !authToken) throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be configured");
    return createClient({ url, authToken });
  }

  async #ensureSetup() {
    if (!this.setup) this.setup = Promise.all(setupSql.map((sql) => this.client.execute(sql)));
    await this.setup;
  }
}
