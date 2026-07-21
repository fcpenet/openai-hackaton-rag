import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { handleRequest, setCommerceStoreForTesting, setUserStoreForTesting } from "../src/product-api.js";

function createResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
    },
    end(body = "") {
      this.body = body;
    }
  };
}

async function request(method, url, { body, token } = {}) {
  const response = createResponse();
  await handleRequest({
    method,
    url,
    body,
    headers: { host: "localhost:3000", ...(token ? { authorization: `Bearer ${token}` } : {}) }
  }, response);
  return { ...response, json: response.body ? JSON.parse(response.body) : undefined };
}

function createCommerceStore() {
  const state = {
    wallets: new Map(),
    carts: new Map(),
    orders: new Map(),
    transactions: new Map(),
    orderCount: 0
  };

  const ensureWallet = (userId) => {
    if (!state.wallets.has(userId)) {
      state.wallets.set(userId, { balance: 0, createdAt: "2026-07-19T00:00:00.000Z", updatedAt: "2026-07-19T00:00:00.000Z" });
    }
    return state.wallets.get(userId);
  };

  const cartSummary = (items) => ({
    items,
    itemCount: items.reduce((total, item) => total + item.quantity, 0),
    totalAmount: items.reduce((total, item) => total + item.quantity * item.product.price.amount, 0),
    currency: items[0]?.product?.price?.currency || "PHP"
  });

  return {
    async getWallet(userId) {
      const wallet = ensureWallet(userId);
      return { userId, ...wallet };
    },
    async topUpWallet(userId, amount) {
      const wallet = ensureWallet(userId);
      wallet.balance += amount;
      wallet.updatedAt = "2026-07-19T00:00:00.000Z";
      const entries = state.transactions.get(userId) || [];
      entries.unshift({
        id: `tx-${entries.length + 1}`,
        kind: "topup",
        amount,
        balanceAfter: wallet.balance,
        metadata: {},
        createdAt: "2026-07-19T00:00:00.000Z"
      });
      state.transactions.set(userId, entries);
      return { userId, ...wallet };
    },
    async listWalletTransactions(userId) {
      return state.transactions.get(userId) || [];
    },
    async getCart(userId) {
      const items = [...(state.carts.get(userId) || new Map()).values()];
      return cartSummary(items);
    },
    async addCartItem(userId, input) {
      const items = state.carts.get(userId) || new Map();
      const product = input.product;
      const quantity = input.quantity || 1;
      items.set(product.id, {
        itemId: product.id,
        quantity,
        product,
        addedAt: "2026-07-19T00:00:00.000Z",
        updatedAt: "2026-07-19T00:00:00.000Z"
      });
      state.carts.set(userId, items);
      return cartSummary([...items.values()]);
    },
    async removeCartItem(userId, itemId) {
      const items = state.carts.get(userId) || new Map();
      items.delete(itemId);
      state.carts.set(userId, items);
      return cartSummary([...items.values()]);
    },
    async checkout(userId, input = {}) {
      const wallet = ensureWallet(userId);
      const cartItems = [...(state.carts.get(userId) || new Map()).values()];
      const items = Array.isArray(input.items) && input.items.length ? input.items.map((item) => ({
        itemId: item.product.id,
        quantity: item.quantity || 1,
        product: item.product
      })) : cartItems.map((item) => ({
        itemId: item.itemId,
        quantity: item.quantity,
        product: item.product
      }));
      const totalAmount = items.reduce((total, item) => total + item.quantity * item.product.price.amount, 0);
      if (wallet.balance < totalAmount) {
        const error = new Error("Insufficient wallet balance");
        error.status = 402;
        throw error;
      }
      wallet.balance -= totalAmount;
      const id = `order-${++state.orderCount}`;
      const now = "2026-07-19T00:00:00.000Z";
      const order = {
        id,
        status: "placed",
        nextStatus: "packed",
        estimatedDeliveryAt: "2026-07-21T00:00:00.000Z",
        deliverySchedule: {
          stages: [
            { status: "placed", at: now, note: "Order received" },
            { status: "packed", at: "2026-07-19T02:00:00.000Z", note: "Packed by warehouse" },
            { status: "shipped", at: "2026-07-19T12:00:00.000Z", note: "Handed to carrier" },
            { status: "out_for_delivery", at: "2026-07-20T00:00:00.000Z", note: "Carrier on route" },
            { status: "delivered", at: "2026-07-21T00:00:00.000Z", note: "Delivered" }
          ]
        },
        deliveryTimeline: [
          { status: "placed", at: now, note: "Order received" },
          { status: "packed", at: "2026-07-19T02:00:00.000Z", note: "Packed by warehouse" },
          { status: "shipped", at: "2026-07-19T12:00:00.000Z", note: "Handed to carrier" },
          { status: "out_for_delivery", at: "2026-07-20T00:00:00.000Z", note: "Carrier on route" },
          { status: "delivered", at: "2026-07-21T00:00:00.000Z", note: "Delivered" }
        ],
        paymentStatus: "paid",
        totalAmount,
        currency: items[0]?.product?.price?.currency || "PHP",
        itemCount: items.reduce((total, item) => total + item.quantity, 0),
        checkoutSource: input.source || "cart",
        createdAt: now,
        updatedAt: now,
        items: items.map((item) => ({
          itemId: item.itemId,
          quantity: item.quantity,
          unitPrice: item.product.price.amount,
          product: item.product,
          createdAt: now
        }))
      };
      state.orders.set(userId, [order, ...(state.orders.get(userId) || [])]);
      if (!input.items?.length) state.carts.delete(userId);
      return order;
    },
    async listOrders(userId) {
      return state.orders.get(userId) || [];
    },
    async getOrder(userId, orderId) {
      return (state.orders.get(userId) || []).find((order) => order.id === orderId);
    },
    async getOrderStatus(userId, orderId) {
      const order = await this.getOrder(userId, orderId);
      if (!order) return undefined;
      return {
        orderId: order.id,
        status: order.status,
        nextStatus: order.nextStatus,
        estimatedDeliveryAt: order.estimatedDeliveryAt,
        timeline: order.deliveryTimeline,
        paymentStatus: order.paymentStatus,
        totalAmount: order.totalAmount,
        currency: order.currency
      };
    }
  };
}

afterEach(() => {
  setUserStoreForTesting();
  setCommerceStoreForTesting();
});

test("commerce routes require auth and support wallet-backed checkout", async () => {
  setUserStoreForTesting({
    async getUserForToken(token) {
      return token === "session-token"
        ? { id: "user-1", email: "user@example.com", displayName: "User", createdAt: "2026-07-19T00:00:00.000Z" }
        : undefined;
    }
  });
  setCommerceStoreForTesting(createCommerceStore());

  const productResponse = await request("GET", "/api/products/search?q=portable%20desk&limit=1");
  const product = productResponse.json.products[0];
  const checkoutAmount = (product.price.amount * 2) + 100000;

  const unauthenticated = await request("GET", "/api/cart");
  assert.equal(unauthenticated.statusCode, 401);

  const walletBefore = await request("GET", "/api/wallet", { token: "session-token" });
  assert.equal(walletBefore.statusCode, 200);
  assert.equal(walletBefore.json.balance, 0);

  const topUp = await request("POST", "/api/wallet/topup", {
    token: "session-token",
    body: { amount: checkoutAmount, metadata: { source: "hackathon-demo" } }
  });
  assert.equal(topUp.statusCode, 200);
  assert.equal(topUp.json.balance, checkoutAmount);

  const addToCart = await request("POST", "/api/cart/items", {
    token: "session-token",
    body: { product, quantity: 2 }
  });
  assert.equal(addToCart.statusCode, 200);
  assert.equal(addToCart.json.itemCount, 2);

  const checkout = await request("POST", "/api/checkout", { token: "session-token" });
  assert.equal(checkout.statusCode, 200);
  assert.equal(checkout.json.checkoutSource, "cart");
  assert.equal(checkout.json.paymentStatus, "paid");
  assert.ok(checkout.json.estimatedDeliveryAt);

  const cartAfter = await request("GET", "/api/cart", { token: "session-token" });
  assert.equal(cartAfter.statusCode, 200);
  assert.equal(cartAfter.json.itemCount, 0);

  const orders = await request("GET", "/api/orders", { token: "session-token" });
  assert.equal(orders.statusCode, 200);
  assert.equal(orders.json.orders.length, 1);

  const orderId = orders.json.orders[0].id;
  const order = await request("GET", `/api/orders/${orderId}`, { token: "session-token" });
  assert.equal(order.statusCode, 200);
  assert.equal(order.json.id, orderId);

  const status = await request("GET", `/api/orders/${orderId}/status`, { token: "session-token" });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json.orderId, orderId);
  assert.ok(status.json.timeline.length >= 3);
});

test("featured and selling-fast work without q", async () => {
  const sellingFast = await request("GET", "/api/products/selling-fast");
  assert.equal(sellingFast.statusCode, 200);
  assert.equal(sellingFast.json.products.length, 6);

  const featured = await request("GET", "/api/products/featured");
  assert.equal(featured.statusCode, 200);
  assert.equal(featured.json.products.length, 1);
});
