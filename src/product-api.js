import http from "node:http";
import { fileURLToPath } from "node:url";
import { CommerceStore } from "./commerce.js";
import { createIntergalacticCollection } from "./intergalactic-mart.js";
import { compareFeatured, compareSalesVelocity, enrichWithMarket } from "./market-economy.js";
import { MarketStore } from "./market-store.js";
import { createOnDemandCollection } from "./on-demand-catalog.js";
import { createProductImage, createReviews } from "./product-presentation.js";
import { buildCompareVerdicts, buildShelfRows, normalizePersona, repairGeneratedProduct } from "./product-intelligence.js";
import { normalizeEmail, validateRegistration } from "./users.js";

const port = Number(process.env.PORT || 3000);
let catalogPromise;
let userStorePromise;
let commerceStorePromise;
let marketStorePromise;

async function getCatalog() {
  if (!catalogPromise) {
    catalogPromise = import("./catalog.js")
      .then(({ Catalog }) => new Catalog())
      .catch(() => null);
  }
  return catalogPromise;
}

async function getUserStore() {
  if (!userStorePromise) {
    userStorePromise = import("./users.js")
      .then(({ UserStore }) => new UserStore())
      .catch(() => null);
  }
  return userStorePromise;
}

// Keeps the HTTP layer independently testable without requiring a live Turso database.
export function setUserStoreForTesting(store) {
  userStorePromise = store ? Promise.resolve(store) : undefined;
}

async function getCommerceStore() {
  if (!commerceStorePromise) {
    commerceStorePromise = Promise.resolve().then(() => new CommerceStore()).catch(() => null);
  }
  return commerceStorePromise;
}

export function setCommerceStoreForTesting(store) {
  commerceStorePromise = store ? Promise.resolve(store) : undefined;
}

async function getMarketStore() {
  if (!marketStorePromise) marketStorePromise = Promise.resolve().then(() => new MarketStore()).catch(() => null);
  return marketStorePromise;
}

export function setMarketStoreForTesting(store) {
  marketStorePromise = store ? Promise.resolve(store) : undefined;
}

function json(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(body));
}

function html(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
  response.end(body);
}

async function readJson(request) {
  if (request.body && typeof request.body === "object" && !request[Symbol.asyncIterator]) return request.body;
  if (!request || typeof request[Symbol.asyncIterator] !== "function") return request.body && typeof request.body === "object" ? request.body : {};
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (Buffer.concat(chunks).length > 64 * 1024) throw new Error("Request body is too large");
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON");
    error.status = 400;
    throw error;
  }
}

function bearerToken(request) {
  const value = request.headers.authorization || request.headers.Authorization || "";
  return /^Bearer\s+(.+)$/i.exec(value)?.[1]?.trim();
}

async function requireAuthedUser(request, response) {
  const token = bearerToken(request);
  if (!token) {
    json(response, 401, { error: "Authentication required" });
    return null;
  }
  const store = await getUserStore();
  if (!store) {
    json(response, 503, { error: "User storage is unavailable. Configure Turso to enable accounts." });
    return null;
  }
  try {
    const user = await store.getUserForToken(token);
    if (!user) {
      json(response, 401, { error: "Authentication required" });
      return null;
    }
    return { store, user };
  } catch (error) {
    json(response, 502, { error: error.message || "Could not load user" });
    return null;
  }
}

async function handleRegistration(request, response) {
  const input = await readJson(request);
  const validationError = validateRegistration(input);
  if (validationError) return json(response, 400, { error: validationError });
  const store = await getUserStore();
  if (!store) return json(response, 503, { error: "User storage is unavailable. Configure Turso to enable accounts." });
  try {
    const user = await store.register(input);
    const login = await store.login({ email: input.email, password: input.password });
    return json(response, 201, { user, token: login.token });
  } catch (error) {
    return json(response, error.code === "EMAIL_TAKEN" ? 409 : 502, { error: error.message || "Could not create user" });
  }
}

async function handleLogin(request, response) {
  const input = await readJson(request);
  if (!normalizeEmail(input.email) || typeof input.password !== "string") return json(response, 400, { error: "Email and password are required" });
  const store = await getUserStore();
  if (!store) return json(response, 503, { error: "User storage is unavailable. Configure Turso to enable accounts." });
  try {
    const login = await store.login(input);
    if (!login) return json(response, 401, { error: "Invalid email or password" });
    return json(response, 200, login);
  } catch (error) {
    return json(response, 502, { error: error.message || "Could not sign in" });
  }
}

async function handleCurrentUser(request, response) {
  const token = bearerToken(request);
  if (!token) return json(response, 401, { error: "Authentication required" });
  const store = await getUserStore();
  if (!store) return json(response, 503, { error: "User storage is unavailable. Configure Turso to enable accounts." });
  try {
    const user = await store.getUserForToken(token);
    if (!user) return json(response, 401, { error: "Authentication required" });
    return json(response, 200, { user, profile: await store.getProfile(user.id) });
  } catch (error) {
    return json(response, 502, { error: error.message || "Could not load user" });
  }
}

async function handleProfileUpdate(request, response) {
  const token = bearerToken(request);
  if (!token) return json(response, 401, { error: "Authentication required" });
  const store = await getUserStore();
  if (!store) return json(response, 503, { error: "User storage is unavailable. Configure Turso to enable accounts." });
  try {
    const user = await store.getUserForToken(token);
    if (!user) return json(response, 401, { error: "Authentication required" });
    return json(response, 200, { user, profile: await store.updateProfile(user.id, await readJson(request)) });
  } catch (error) {
    return json(response, error.status || 502, { error: error.message || "Could not update profile" });
  }
}

async function handleLogout(request, response) {
  const token = bearerToken(request);
  if (!token) return json(response, 204, undefined);
  const store = await getUserStore();
  if (!store) return json(response, 503, { error: "User storage is unavailable. Configure Turso to enable accounts." });
  try {
    await store.logout(token);
    return json(response, 204, undefined);
  } catch (error) {
    return json(response, 502, { error: error.message || "Could not sign out" });
  }
}

function parseSearch(url) {
  const query = url.searchParams.get("q")?.trim();
  const requestedLimit = Number(url.searchParams.get("limit") || 12);
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 12, 1), 50);
  const secretMode = url.searchParams.get("not-suspicious") === "Hum^n";
  const requestedPersona = url.searchParams.get("persona");
  const persona = secretMode ? "intergalactic" : normalizePersona(requestedPersona || "normal");
  return { query, limit, secretMode, persona, hasExplicitPersona: Boolean(requestedPersona) };
}

function defaultCuratedQuery(label, query) {
  return query || label;
}

function getOpenApiDocument() {
  return {
    openapi: "3.0.3",
    info: {
      title: "Product Discovery Service",
      version: "0.1.0",
      description: "On-demand product search and streaming API backed by Turso. Includes a deterministic UTC-day market simulator that tracks inventory, sales velocity, demand, and featured ranking."
    },
    servers: [{ url: "/" }],
    paths: {
      "/health": {
        get: {
          summary: "Health check",
          responses: {
            "200": {
              description: "Service is healthy",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { ok: { type: "boolean", example: true } },
                    required: ["ok"]
                  }
                }
              }
            }
          }
        }
      },
      "/api/users/register": {
        post: {
          summary: "Create a user account",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/RegisterInput" } } }
          },
          responses: {
            "201": { description: "Account created", content: { "application/json": { schema: { $ref: "#/components/schemas/AuthResponse" } } } },
            "409": { description: "Email already registered" }
          }
        }
      },
      "/api/users/login": {
        post: {
          summary: "Sign in and create a session",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/LoginInput" } } }
          },
          responses: {
            "200": { description: "Signed in", content: { "application/json": { schema: { $ref: "#/components/schemas/AuthResponse" } } } },
            "401": { description: "Invalid credentials" }
          }
        }
      },
      "/api/users/me": {
        get: {
          summary: "Get the current user and profile",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "Current user", content: { "application/json": { schema: { $ref: "#/components/schemas/UserProfileResponse" } } } },
            "401": { description: "Authentication required" }
          }
        },
        put: {
          summary: "Update the current user's discovery profile",
          security: [{ bearerAuth: [] }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ProfileInput" } } } },
          responses: {
            "200": { description: "Profile updated", content: { "application/json": { schema: { $ref: "#/components/schemas/UserProfileResponse" } } } },
            "400": { description: "Invalid profile" },
            "401": { description: "Authentication required" }
          }
        }
      },
      "/api/users/logout": {
        post: {
          summary: "End the current session",
          security: [{ bearerAuth: [] }],
          responses: { "204": { description: "Signed out" } }
        }
      },
      "/api/products/search": {
        get: {
          summary: "Search products",
          parameters: [
            {
              name: "q",
              in: "query",
              required: true,
              schema: { type: "string" },
              description: "Search phrase for the product collection"
            },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 50, default: 12 },
              description: "Maximum number of products to return"
            },
            {
              name: "not-suspicious",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["Hum^n"] },
              description: "Optional hidden toggle that switches to the intergalactic mart catalog"
            },
            {
              name: "persona",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["normal", "luxury", "bargain", "minimalist"] },
              description: "Optional catalog persona for the generated shelf"
            }
          ],
          responses: {
            "200": {
              description: "Normalized product collection",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      products: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Product" }
                      },
                      source: { type: "string", enum: ["catalog", "on-demand-catalog", "intergalactic-mart"] },
                      generatedOnDemand: { type: "boolean" },
                      persona: { type: "string" },
                      provenance: { $ref: "#/components/schemas/Provenance" }
                    },
                    required: ["products", "source", "generatedOnDemand", "persona", "provenance"]
                  }
                }
              }
            },
            "400": { description: "Missing q parameter" },
            "502": { description: "Product generation failed" }
          }
        }
      },
      "/v1/products/search": {
        get: {
          summary: "Search products",
          deprecated: true,
          parameters: [
            {
              name: "q",
              in: "query",
              required: true,
              schema: { type: "string" }
            },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 50, default: 12 }
            },
            {
              name: "not-suspicious",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["Hum^n"] }
            },
            {
              name: "persona",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["normal", "luxury", "bargain", "minimalist"] }
            }
          ],
          responses: {
            "200": { description: "Normalized product collection" }
          }
        }
      },
      "/api/products/selling-fast": {
        get: {
          summary: "Get the six fastest-selling products for a search",
          parameters: [
            { name: "q", in: "query", required: false, schema: { type: "string" }, description: "Search phrase for the product collection" },
            { name: "not-suspicious", in: "query", required: false, schema: { type: "string", enum: ["Hum^n"] } },
            { name: "persona", in: "query", required: false, schema: { type: "string", enum: ["normal", "luxury", "bargain", "minimalist"] } }
          ],
          responses: {
            "200": { description: "Six products ordered by simulated sales velocity", content: { "application/json": { schema: { $ref: "#/components/schemas/ProductCollection" } } } },
            "502": { description: "Product generation failed" }
          }
        }
      },
      "/api/products/featured": {
        get: {
          summary: "Get the featured product for a search",
          parameters: [
            { name: "q", in: "query", required: false, schema: { type: "string" }, description: "Search phrase for the product collection" },
            { name: "not-suspicious", in: "query", required: false, schema: { type: "string", enum: ["Hum^n"] } },
            { name: "persona", in: "query", required: false, schema: { type: "string", enum: ["normal", "luxury", "bargain", "minimalist"] } }
          ],
          responses: {
            "200": { description: "One featured product", content: { "application/json": { schema: { $ref: "#/components/schemas/ProductCollection" } } } },
            "502": { description: "Product generation failed" }
          }
        }
      },
      "/api/products/stream": {
        get: {
          summary: "Stream products with Server-Sent Events",
          parameters: [
            {
              name: "q",
              in: "query",
              required: true,
              schema: { type: "string" }
            },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 50, default: 12 }
            },
            {
              name: "not-suspicious",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["Hum^n"] }
            },
            {
              name: "persona",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["normal", "luxury", "bargain", "minimalist"] }
            }
          ],
          responses: {
            "200": {
              description: "SSE stream of status, product, and done events",
              content: {
                "text/event-stream": {
                  schema: { type: "string" }
                }
              }
            }
          }
        }
      },
      "/api/products/shelf": {
        get: {
          summary: "Stream a shelf grouped into shopping rows",
          parameters: [
            {
              name: "q",
              in: "query",
              required: true,
              schema: { type: "string" }
            },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 4, maximum: 50, default: 12 }
            },
            {
              name: "not-suspicious",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["Hum^n"] }
            },
            {
              name: "persona",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["normal", "luxury", "bargain", "minimalist"] }
            }
          ],
          responses: {
            "200": {
              description: "SSE stream of shelf rows",
              content: {
                "text/event-stream": {
                  schema: { type: "string" }
                }
              }
            }
          }
        }
      },
      "/api/products/compare": {
        get: {
          summary: "Compare 2 to 4 products side by side",
          parameters: [
            {
              name: "q",
              in: "query",
              required: true,
              schema: { type: "string" }
            },
            {
              name: "count",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 2, maximum: 4, default: 4 }
            },
            {
              name: "ids",
              in: "query",
              required: false,
              schema: { type: "string" },
              description: "Comma-separated product IDs to compare"
            },
            {
              name: "not-suspicious",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["Hum^n"] }
            },
            {
              name: "persona",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["normal", "luxury", "bargain", "minimalist"] }
            }
          ],
          responses: {
            "200": {
              description: "Comparison verdicts and selected products",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      products: { type: "array", items: { $ref: "#/components/schemas/Product" } },
                      verdicts: { type: "object" },
                      persona: { type: "string" },
                      provenance: { $ref: "#/components/schemas/Provenance" }
                    },
                    required: ["products", "verdicts", "persona", "provenance"]
                  }
                }
              }
            }
          }
        }
      },
      "/api/cart": {
        get: {
          summary: "Get the authenticated user's cart",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "Cart contents", content: { "application/json": { schema: { $ref: "#/components/schemas/Cart" } } } },
            "401": { description: "Authentication required" }
          }
        }
      },
      "/api/cart/items": {
        post: {
          summary: "Add an item to the authenticated user's cart",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CartItemInput" } } }
          },
          responses: {
            "200": { description: "Updated cart", content: { "application/json": { schema: { $ref: "#/components/schemas/Cart" } } } },
            "400": { description: "Invalid cart item" },
            "401": { description: "Authentication required" }
          }
        }
      },
      "/api/cart/items/{itemId}": {
        delete: {
          summary: "Remove an item from the authenticated user's cart",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "itemId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Updated cart", content: { "application/json": { schema: { $ref: "#/components/schemas/Cart" } } } },
            "401": { description: "Authentication required" }
          }
        }
      },
      "/api/wallet": {
        get: {
          summary: "Get the authenticated user's wallet",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "Wallet state", content: { "application/json": { schema: { $ref: "#/components/schemas/Wallet" } } } },
            "401": { description: "Authentication required" }
          }
        }
      },
      "/api/wallet/topup": {
        post: {
          summary: "Add funds to the authenticated user's wallet",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/TopUpRequest" } } }
          },
          responses: {
            "200": { description: "Updated wallet", content: { "application/json": { schema: { $ref: "#/components/schemas/Wallet" } } } },
            "400": { description: "Invalid amount" },
            "401": { description: "Authentication required" }
          }
        }
      },
      "/api/wallet/transactions": {
        get: {
          summary: "List wallet transactions",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "Wallet transaction ledger",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { transactions: { type: "array", items: { $ref: "#/components/schemas/WalletTransaction" } } },
                    required: ["transactions"]
                  }
                }
              }
            },
            "401": { description: "Authentication required" }
          }
        }
      },
      "/api/checkout": {
        post: {
          summary: "Checkout items for the authenticated user",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: false,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CheckoutRequest" } } }
          },
          responses: {
            "200": { description: "Created order", content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } } },
            "400": { description: "Invalid checkout" },
            "401": { description: "Authentication required" },
            "402": { description: "Insufficient wallet balance" }
          }
        }
      },
      "/api/orders": {
        get: {
          summary: "List the authenticated user's orders",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "Order history",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { orders: { type: "array", items: { $ref: "#/components/schemas/Order" } } },
                    required: ["orders"]
                  }
                }
              }
            },
            "401": { description: "Authentication required" }
          }
        }
      },
      "/api/orders/{orderId}": {
        get: {
          summary: "Get one authenticated order",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "orderId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Order details", content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } } },
            "401": { description: "Authentication required" },
            "404": { description: "Order not found" }
          }
        }
      },
      "/api/orders/{orderId}/status": {
        get: {
          summary: "Get the delivery status for an authenticated order",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "orderId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Order delivery status", content: { "application/json": { schema: { $ref: "#/components/schemas/OrderStatus" } } } },
            "401": { description: "Authentication required" },
            "404": { description: "Order not found" }
          }
        }
      }
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "session token" }
      },
      schemas: {
        ProductCollection: {
          type: "object",
          properties: {
            products: { type: "array", items: { $ref: "#/components/schemas/Product" } },
            source: { type: "string" },
            generatedOnDemand: { type: "boolean" },
            persona: { type: "string" },
            provenance: { $ref: "#/components/schemas/Provenance" }
          },
          required: ["products", "source", "generatedOnDemand", "persona", "provenance"]
        },
        CartItemInput: {
          type: "object",
          properties: {
            product: { $ref: "#/components/schemas/Product" },
            quantity: { type: "integer", minimum: 1, default: 1 }
          },
          required: ["product"]
        },
        CartItem: {
          type: "object",
          properties: {
            itemId: { type: "string" },
            quantity: { type: "integer" },
            product: { $ref: "#/components/schemas/Product" },
            addedAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" }
          },
          required: ["itemId", "quantity", "product", "addedAt", "updatedAt"]
        },
        Cart: {
          type: "object",
          properties: {
            items: { type: "array", items: { $ref: "#/components/schemas/CartItem" } },
            itemCount: { type: "integer" },
            totalAmount: { type: "integer" },
            currency: { type: "string" }
          },
          required: ["items", "itemCount", "totalAmount", "currency"]
        },
        TopUpRequest: {
          type: "object",
          properties: {
            amount: { type: "integer", minimum: 1 },
            metadata: { type: "object", additionalProperties: true }
          },
          required: ["amount"]
        },
        Wallet: {
          type: "object",
          properties: {
            userId: { type: "string" },
            balance: { type: "integer" },
            createdAt: { type: ["string", "null"], format: "date-time" },
            updatedAt: { type: ["string", "null"], format: "date-time" }
          },
          required: ["userId", "balance", "createdAt", "updatedAt"]
        },
        WalletTransaction: {
          type: "object",
          properties: {
            id: { type: "string" },
            kind: { type: "string" },
            amount: { type: "integer" },
            balanceAfter: { type: "integer" },
            metadata: { type: "object", additionalProperties: true },
            createdAt: { type: "string", format: "date-time" }
          },
          required: ["id", "kind", "amount", "balanceAfter", "metadata", "createdAt"]
        },
        CheckoutRequest: {
          type: "object",
          properties: {
            source: { type: "string", enum: ["cart", "direct"] },
            items: { type: "array", items: { $ref: "#/components/schemas/CartItemInput" } }
          }
        },
        OrderItem: {
          type: "object",
          properties: {
            itemId: { type: "string" },
            quantity: { type: "integer" },
            unitPrice: { type: "integer" },
            product: { $ref: "#/components/schemas/Product" },
            createdAt: { type: "string", format: "date-time" }
          },
          required: ["itemId", "quantity", "unitPrice", "product", "createdAt"]
        },
        OrderStatus: {
          type: "object",
          properties: {
            orderId: { type: "string" },
            status: { type: "string" },
            nextStatus: { type: ["string", "null"] },
            estimatedDeliveryAt: { type: ["string", "null"], format: "date-time" },
            timeline: { type: "array", items: { type: "object" } },
            paymentStatus: { type: "string" },
            totalAmount: { type: "integer" },
            currency: { type: "string" }
          },
          required: ["orderId", "status", "nextStatus", "estimatedDeliveryAt", "timeline", "paymentStatus", "totalAmount", "currency"]
        },
        Order: {
          type: "object",
          properties: {
            id: { type: "string" },
            status: { type: "string" },
            nextStatus: { type: ["string", "null"] },
            estimatedDeliveryAt: { type: ["string", "null"], format: "date-time" },
            deliverySchedule: { type: "object" },
            deliveryTimeline: { type: "array", items: { type: "object" } },
            paymentStatus: { type: "string" },
            totalAmount: { type: "integer" },
            currency: { type: "string" },
            itemCount: { type: "integer" },
            checkoutSource: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
            items: { type: "array", items: { $ref: "#/components/schemas/OrderItem" } }
          },
          required: ["id", "status", "nextStatus", "estimatedDeliveryAt", "deliverySchedule", "deliveryTimeline", "paymentStatus", "totalAmount", "currency", "itemCount", "checkoutSource", "createdAt", "updatedAt"]
        },
        RegisterInput: {
          type: "object",
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 8, format: "password" },
            displayName: { type: "string", maxLength: 80 }
          },
          required: ["email", "password"]
        },
        LoginInput: {
          type: "object",
          properties: { email: { type: "string", format: "email" }, password: { type: "string", format: "password" } },
          required: ["email", "password"]
        },
        User: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            email: { type: "string", format: "email" },
            displayName: { type: "string" },
            createdAt: { type: "string", format: "date-time" }
          },
          required: ["id", "email", "displayName", "createdAt"]
        },
        AuthResponse: {
          type: "object",
          properties: { user: { $ref: "#/components/schemas/User" }, token: { type: "string" } },
          required: ["user", "token"]
        },
        ProfileInput: {
          type: "object",
          properties: {
            persona: { type: "string", enum: ["normal", "luxury", "bargain", "minimalist"] },
            budgetMin: { type: "integer", minimum: 0, description: "Minimum simulated price in PHP" },
            budgetMax: { type: "integer", minimum: 0, description: "Maximum simulated price in PHP" },
            preferredCategories: { type: "array", items: { type: "string" }, maxItems: 20 },
            excludedCategories: { type: "array", items: { type: "string" }, maxItems: 20 }
          }
        },
        Profile: {
          allOf: [{ $ref: "#/components/schemas/ProfileInput" }],
          type: "object",
          properties: { updatedAt: { type: ["string", "null"], format: "date-time" } },
          required: ["persona", "budgetMin", "budgetMax", "preferredCategories", "excludedCategories", "updatedAt"]
        },
        UserProfileResponse: {
          type: "object",
          properties: { user: { $ref: "#/components/schemas/User" }, profile: { $ref: "#/components/schemas/Profile" } },
          required: ["user", "profile"]
        },
        Product: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            description: { type: ["string", "null"] },
            category: { type: "string" },
            imageUrl: { type: "string" },
            persona: { type: "string" },
            explanation: { type: "string" },
            rating: { type: ["integer", "null"], minimum: 1, maximum: 5 },
            reviewCount: { type: "integer", minimum: 0, maximum: 250 },
            reviews: {
              type: "array",
              items: { $ref: "#/components/schemas/Review" }
            },
            price: { $ref: "#/components/schemas/Price" },
            source: { $ref: "#/components/schemas/Source" },
            provenance: { $ref: "#/components/schemas/Provenance" },
            market: { $ref: "#/components/schemas/MarketState" }
          },
          required: ["id", "title", "category", "imageUrl", "persona", "explanation", "rating", "reviewCount", "reviews", "price", "source", "provenance", "market"]
        },
        Review: {
          type: "object",
          properties: {
            id: { type: "string" },
            author: { type: "string" },
            rating: { type: "integer", minimum: 1, maximum: 5 },
            title: { type: "string" },
            body: { type: "string" },
            createdAt: { type: "string", format: "date-time" }
          },
          required: ["id", "author", "rating", "title", "body", "createdAt"]
        },
        Price: {
          type: "object",
          properties: {
            amount: { type: "integer" },
            currency: { type: "string" },
            isSimulated: { type: "boolean" }
          },
          required: ["amount", "currency", "isSimulated"]
        },
        MarketState: {
          type: "object",
          description: "Deterministic simulated market state for the current UTC day.",
          properties: {
            day: { type: "string", format: "date" },
            source: { type: "string", enum: ["seeded", "observed"], description: "Whether real checkouts have influenced this product today" },
            inventory: { type: "integer", minimum: 0 },
            unitsSold: { type: "integer", minimum: 0 },
            salesVelocity: { type: "integer", minimum: 0, description: "Simulated units sold today" },
            demandScore: { type: "integer", minimum: 0 },
            featuredScore: { type: "integer", minimum: 0 },
            trend: { type: "string", enum: ["rising", "steady", "cooling"] }
          },
          required: ["day", "source", "inventory", "unitsSold", "salesVelocity", "demandScore", "featuredScore", "trend"]
        },
        Source: {
          type: "object",
          properties: {
            provider: { type: "string" },
            itemId: { type: "string" },
            url: { type: "string" },
            retrievedAt: { type: "string", format: "date-time" },
            license: { type: "string" }
          },
          required: ["provider", "itemId", "url", "retrievedAt", "license"]
        },
        Provenance: {
          type: "object",
          properties: {
            query: { type: "string" },
            persona: { type: "string" },
            cached: { type: "boolean" }
          },
          required: ["query", "persona", "cached"]
        }
      }
    }
  };
}

function getDocsHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Product Discovery Service API Docs</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body { margin: 0; background: #f7f8fb; }
      .topbar { display: none; }
    </style>
  </head>
  <body>
    <div style="position:fixed;top:14px;right:16px;z-index:10;font:600 12px/1.2 system-ui,sans-serif;">
      <a href="/economy" style="color:#111827;text-decoration:none;border:1px solid #d1d5db;background:#fff;padding:10px 14px;border-radius:999px;box-shadow:0 4px 18px rgba(17,24,39,0.08);">Market view</a>
    </div>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: "/openapi.json",
        dom_id: "#swagger-ui",
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: "BaseLayout"
      });
    </script>
  </body>
</html>`;
}

function getEconomyHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Market Simulator</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4efe3;
        --panel: rgba(255, 251, 242, 0.9);
        --panel-strong: #fff7ea;
        --text: #171717;
        --muted: #6b7280;
        --border: rgba(23, 23, 23, 0.08);
        --accent: #1f9d55;
        --accent-2: #d97706;
        --accent-3: #2563eb;
        --accent-4: #7c3aed;
        --shadow: 0 20px 70px rgba(17, 24, 39, 0.08);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background:
          linear-gradient(180deg, rgba(255,255,255,0.72), rgba(255,255,255,0.42)),
          radial-gradient(circle at top left, rgba(37, 99, 235, 0.08), transparent 34%),
          radial-gradient(circle at top right, rgba(31, 157, 85, 0.08), transparent 28%),
          var(--bg);
        color: var(--text);
      }
      a { color: inherit; }
      .page {
        min-height: 100vh;
        padding: 24px;
      }
      .shell {
        max-width: 1280px;
        margin: 0 auto;
      }
      .hero {
        position: relative;
        overflow: hidden;
        padding: 28px;
        border: 1px solid var(--border);
        border-radius: 24px;
        background:
          linear-gradient(135deg, rgba(255, 247, 234, 0.88), rgba(255, 255, 255, 0.72)),
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1200' height='420' viewBox='0 0 1200 420'%3E%3Cg fill='none' stroke='%23d9d4c8' stroke-opacity='.55'%3E%3Cpath d='M0 54H1200M0 118H1200M0 182H1200M0 246H1200M0 310H1200M0 374H1200'/%3E%3Cpath d='M118 18V402M264 18V402M410 18V402M556 18V402M702 18V402M848 18V402M994 18V402M1140 18V402'/%3E%3C/g%3E%3C/svg%3E") center/cover;
        box-shadow: var(--shadow);
      }
      .hero-top {
        display: flex;
        gap: 20px;
        justify-content: space-between;
        align-items: end;
        flex-wrap: wrap;
      }
      .eyebrow {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--accent-2);
      }
      h1 {
        margin: 8px 0 10px;
        font-size: clamp(30px, 4vw, 54px);
        line-height: 1.02;
        letter-spacing: 0;
      }
      .lede {
        max-width: 760px;
        margin: 0;
        color: var(--muted);
        font-size: 15px;
        line-height: 1.55;
      }
      .controls {
        display: flex;
        gap: 12px;
        align-items: center;
        flex-wrap: wrap;
      }
      .input {
        min-width: min(420px, 100%);
        padding: 14px 16px;
        border: 1px solid var(--border);
        border-radius: 14px;
        background: rgba(255,255,255,0.88);
        color: var(--text);
        font: inherit;
      }
      .button {
        padding: 14px 18px;
        border: 0;
        border-radius: 14px;
        background: #171717;
        color: white;
        font-weight: 700;
        cursor: pointer;
      }
      .button.secondary {
        background: #fff;
        color: var(--text);
        border: 1px solid var(--border);
      }
      .stats {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 14px;
        margin-top: 22px;
      }
      .stat {
        padding: 16px;
        border-radius: 18px;
        background: var(--panel);
        border: 1px solid var(--border);
      }
      .stat .label {
        font-size: 12px;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .stat .value {
        margin-top: 10px;
        font-size: 30px;
        line-height: 1;
        font-weight: 800;
      }
      .stat .sub {
        margin-top: 6px;
        font-size: 13px;
        color: var(--muted);
      }
      .bands {
        margin-top: 22px;
        display: grid;
        gap: 18px;
      }
      .band {
        padding: 20px;
        border: 1px solid var(--border);
        border-radius: 22px;
        background: rgba(255, 255, 255, 0.78);
        box-shadow: 0 8px 40px rgba(17, 24, 39, 0.05);
      }
      .band-head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: baseline;
        margin-bottom: 14px;
      }
      .band-head h2 {
        margin: 0;
        font-size: 18px;
      }
      .band-head p {
        margin: 0;
        color: var(--muted);
        font-size: 13px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 14px;
      }
      .card {
        border-radius: 18px;
        overflow: hidden;
        background: var(--panel-strong);
        border: 1px solid rgba(17, 24, 39, 0.07);
      }
      .art {
        aspect-ratio: 1 / 0.84;
        background: #fff8ec;
      }
      .art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .card-body {
        padding: 14px;
      }
      .card-top {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        font-size: 12px;
        color: var(--muted);
        margin-bottom: 8px;
      }
      .title {
        margin: 0 0 8px;
        font-size: 16px;
        line-height: 1.25;
      }
      .price {
        font-size: 18px;
        font-weight: 800;
      }
      .marketline {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 12px;
      }
      .pill {
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 700;
        background: rgba(23, 23, 23, 0.06);
      }
      .pill.green { background: rgba(31, 157, 85, 0.12); color: #11683a; }
      .pill.blue { background: rgba(37, 99, 235, 0.12); color: #1d4ed8; }
      .pill.orange { background: rgba(217, 119, 6, 0.12); color: #b45309; }
      .chart {
        display: grid;
        grid-template-columns: repeat(12, minmax(0, 1fr));
        gap: 8px;
        align-items: end;
        min-height: 140px;
        padding-top: 8px;
      }
      .bar {
        border-radius: 14px 14px 4px 4px;
        background: linear-gradient(180deg, rgba(37, 99, 235, 0.92), rgba(37, 99, 235, 0.38));
        position: relative;
        min-height: 14px;
      }
      .bar::after {
        content: attr(data-label);
        position: absolute;
        inset: auto 0 -22px 0;
        text-align: center;
        font-size: 11px;
        color: var(--muted);
      }
      .banner {
        display: flex;
        gap: 16px;
        align-items: center;
        margin-top: 20px;
        padding: 16px 18px;
        border-radius: 18px;
        background: rgba(17, 24, 39, 0.94);
        color: white;
      }
      .banner strong { display: block; font-size: 14px; margin-bottom: 4px; }
      .banner span { color: rgba(255,255,255,0.74); font-size: 13px; }
      .empty {
        padding: 28px;
        text-align: center;
        color: var(--muted);
      }
      @media (max-width: 960px) {
        .stats, .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .input { min-width: 0; flex: 1 1 100%; }
      }
      @media (max-width: 640px) {
        .page { padding: 14px; }
        .stats, .grid { grid-template-columns: 1fr; }
        .hero { padding: 18px; border-radius: 20px; }
        .band { padding: 16px; border-radius: 18px; }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="shell">
        <section class="hero">
          <div class="hero-top">
            <div>
              <div class="eyebrow">Live market simulator</div>
              <h1>Real World Economy</h1>
              <p class="lede">A separate dashboard for the in-world market simulation. Search a product intent, then watch inventory, sales velocity, featured rank, and trend update from the same data that powers the catalog.</p>
            </div>
            <div class="controls">
              <input id="query" class="input" value="${new URLSearchParams().get("q") || "wireless headphones"}" placeholder="Search a product intent" />
              <button id="load" class="button">Load market</button>
              <a class="button secondary" href="/docs" style="text-decoration:none;display:inline-flex;align-items:center;">API docs</a>
            </div>
          </div>
          <div class="stats" id="stats"></div>
          <div class="banner">
            <div style="font-size:22px;line-height:1;">◆</div>
            <div>
              <strong>How it works</strong>
              <span>Every product gets a deterministic UTC-day market state. New checkouts can move items from seeded to observed, which makes the shelves feel alive without relying on random drift.</span>
            </div>
          </div>
        </section>

        <section class="bands">
          <div class="band">
            <div class="band-head">
              <div>
                <h2>Market pulse</h2>
                <p id="pulse-note">Current demand and inventory across the loaded shelf.</p>
              </div>
            </div>
            <div class="chart" id="chart"></div>
          </div>

          <div class="band">
            <div class="band-head">
              <div>
                <h2>Featured shelf</h2>
                <p>Highest featured scores for the selected intent.</p>
              </div>
            </div>
            <div class="grid" id="featured"></div>
          </div>

          <div class="band">
            <div class="band-head">
              <div>
                <h2>Fast movers</h2>
                <p>Items with the strongest sales velocity today.</p>
              </div>
            </div>
            <div class="grid" id="fast"></div>
          </div>
        </section>
      </div>
    </div>
    <script>
      const $ = (id) => document.getElementById(id);
      const currency = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });

      function aggregate(products) {
        const totals = products.reduce((acc, product) => {
          const market = product.market || {};
          acc.inventory += Number(market.inventory || 0);
          acc.salesVelocity += Number(market.salesVelocity || 0);
          acc.demandScore += Number(market.demandScore || 0);
          acc.featuredScore += Number(market.featuredScore || 0);
          acc.seeded += market.source === "seeded" ? 1 : 0;
          acc.observed += market.source === "observed" ? 1 : 0;
          return acc;
        }, { inventory: 0, salesVelocity: 0, demandScore: 0, featuredScore: 0, seeded: 0, observed: 0 });
        const count = Math.max(products.length, 1);
        return {
          inventory: Math.round(totals.inventory / count),
          salesVelocity: Math.round(totals.salesVelocity / count),
          demandScore: Math.round(totals.demandScore / count),
          featuredScore: Math.round(totals.featuredScore / count),
          seeded: totals.seeded,
          observed: totals.observed
        };
      }

      function statTemplate(label, value, sub) {
        return \`<div class="stat"><div class="label">\${label}</div><div class="value">\${value}</div><div class="sub">\${sub}</div></div>\`;
      }

      function cardTemplate(product, accentClass = "") {
        const market = product.market || {};
        return \`
          <article class="card">
            <div class="art"><img src="\${product.imageUrl}" alt="\${product.title.replace(/"/g, "&quot;")}" /></div>
            <div class="card-body">
              <div class="card-top">
                <span>\${product.category}</span>
                <span>\${market.trend || "steady"}</span>
              </div>
              <h3 class="title">\${product.title}</h3>
              <div class="price">\${currency.format(product.price.amount)}</div>
              <div class="marketline">
                <span class="pill green">\${market.salesVelocity || 0} velocity</span>
                <span class="pill blue">\${market.demandScore || 0} demand</span>
                <span class="pill orange">\${market.inventory || 0} stock</span>
              </div>
            </div>
          </article>\`;
      }

      function renderBars(products) {
        const chart = $("chart");
        const max = Math.max(...products.map((product) => Number(product.market?.demandScore || 1)), 1);
        chart.innerHTML = products.map((product, index) => {
          const score = Number(product.market?.demandScore || 0);
          const height = Math.max(18, Math.round((score / max) * 100));
          return \`<div class="bar" style="height:\${height}%;background:linear-gradient(180deg, hsl(\${(index * 47) % 360} 70% 50%), rgba(37,99,235,.24));" data-label="\${product.market?.trend || "steady"}"></div>\`;
        }).join("");
      }

      async function load() {
        const query = $("query").value.trim() || "wireless headphones";
        const [searchResponse, featuredResponse, fastResponse] = await Promise.all([
          fetch(\`/api/products/search?q=\${encodeURIComponent(query)}&limit=12\`),
          fetch(\`/api/products/featured?q=\${encodeURIComponent(query)}\`),
          fetch(\`/api/products/selling-fast?q=\${encodeURIComponent(query)}\`)
        ]);
        const search = await searchResponse.json();
        const featured = await featuredResponse.json();
        const fast = await fastResponse.json();
        const products = search.products || [];
        const summary = aggregate(products);

        $("stats").innerHTML = [
          statTemplate("Avg inventory", summary.inventory, summary.observed + " observed, " + summary.seeded + " seeded"),
          statTemplate("Avg sales velocity", summary.salesVelocity, "per UTC day"),
          statTemplate("Avg demand score", summary.demandScore, "market pressure"),
          statTemplate("Avg featured score", summary.featuredScore, "ranking signal")
        ].join("");

        $("pulse-note").textContent = query + " • " + products.length + " items in the loaded shelf";
        renderBars(products.slice(0, 12));
        $("featured").innerHTML = (featured.products || []).slice(0, 3).map((product) => cardTemplate(product)).join("") || '<div class="empty">No featured products found.</div>';
        $("fast").innerHTML = (fast.products || []).slice(0, 6).map((product) => cardTemplate(product)).join("") || '<div class="empty">No fast movers found.</div>';
      }

      $("load").addEventListener("click", load);
      $("query").addEventListener("keydown", (event) => {
        if (event.key === "Enter") load();
      });
      load().catch((error) => {
        $("stats").innerHTML = '<div class="empty">Unable to load the market right now.</div>';
        console.error(error);
      });
    </script>
  </body>
</html>`;
}

async function resolveCollection(query, limit, persona = "normal") {
  const catalog = await getCatalog();
  const collectionKey = `${persona}:${query}`;
  const cached = catalog ? await catalog.get(collectionKey) : undefined;
  const sourceCollection = cached || (
    persona === "intergalactic"
      ? createIntergalacticCollection(query, 50, { persona })
      : createOnDemandCollection(query, 50, { persona })
  );
  let changed = !cached;
  const collection = sourceCollection.map((product) => {
    const reviews = createReviews(product.id, product.title, product.description, { mode: persona === "intergalactic" ? "alien" : "normal" });
    // Always derive artwork from the individual product identity. This also repairs
    // legacy cached collections whose images were generated from the search alone.
    const imageUrl = createProductImage(product.title, product.description, product.id);
    const needsImage = product.imageUrl !== imageUrl;
    const needsReviews = !Array.isArray(product.reviews) || product.rating === undefined || product.reviewCount === undefined;
    const needsPersona = product.persona === undefined || product.explanation === undefined || product.provenance === undefined;
    if (!needsImage && !needsReviews && !needsPersona) return product;
    changed = true;
    return repairGeneratedProduct({
      ...product,
      imageUrl,
      rating: product.rating ?? reviews.rating,
      reviewCount: product.reviewCount ?? reviews.reviewCount,
      reviews: product.reviews ?? reviews.reviews
    }, { query, persona, cached: Boolean(cached) });
  });
  if (changed && catalog) await catalog.set(collectionKey, collection);
  const marketStore = await getMarketStore();
  const products = await Promise.all(collection.slice(0, limit).map(async (product) => ({
    ...product,
    market: marketStore ? await marketStore.getMarket(product) : enrichWithMarket(product).market
  })));
  const duplicateImages = products.length - new Set(products.map((product) => product.imageUrl)).size;
  if (duplicateImages > 0) {
    console.warn(`[product-api] duplicate imageUrl values detected for query "${query}" (${duplicateImages} duplicates)`);
  }
  return {
    products,
    source: cached ? "catalog" : (persona === "intergalactic" ? "intergalactic-mart" : "on-demand-catalog"),
    cached,
    persona,
    provenance: { query, persona, cached: Boolean(cached) }
  };
}

async function resolvePersonalizedCollection(request, url, minimumLimit = 0) {
  const search = parseSearch(url);
  let profile;
  if (!search.hasExplicitPersona && !search.secretMode) {
    const token = bearerToken(request);
    const store = token && await getUserStore();
    const user = store && await store.getUserForToken(token);
    if (user) profile = await store.getProfile(user.id);
  }
  const persona = profile?.persona || search.persona;
  const result = await resolveCollection(search.query, 50, persona);
  const products = profile ? tailorProducts(result.products, profile) : result.products;
  return {
    ...result,
    products: products.slice(0, Math.max(search.limit, minimumLimit)),
    persona,
    query: search.query,
    limit: search.limit,
    provenance: { ...result.provenance, persona, profileApplied: Boolean(profile) }
  };
}

function tailorProducts(products, profile) {
  const preferred = new Set(profile.preferredCategories.map((category) => category.toLowerCase()));
  const excluded = new Set(profile.excludedCategories.map((category) => category.toLowerCase()));
  const allowed = products.filter((product) => !excluded.has(product.category.toLowerCase()));
  const candidates = allowed.length ? allowed : products;
  const budgetDistance = (amount) => {
    if (profile.budgetMin !== null && amount < profile.budgetMin) return profile.budgetMin - amount;
    if (profile.budgetMax !== null && amount > profile.budgetMax) return amount - profile.budgetMax;
    return 0;
  };
  return [...candidates].sort((left, right) => {
    const preference = Number(preferred.has(right.category.toLowerCase())) - Number(preferred.has(left.category.toLowerCase()));
    return preference || budgetDistance(left.price.amount) - budgetDistance(right.price.amount);
  });
}

async function handleSearch(request, url, response) {
  const { query, limit } = parseSearch(url);
  if (!query) return json(response, 400, { error: "q is required" });
  try {
    const { products, source, cached, provenance, persona } = await resolvePersonalizedCollection(request, url);
    return json(response, 200, { products, source, generatedOnDemand: !cached, persona, provenance }, { "cache-control": "no-store" });
  } catch (error) {
    return json(response, 502, { error: error.message || "Product search failed" });
  }
}

async function handleCuratedCollection(request, url, response, { count, sort }) {
  const { query } = parseSearch(url);
  try {
    const curatedUrl = new URL(url.toString());
    curatedUrl.searchParams.set("q", defaultCuratedQuery("curated picks", query));
    const result = await resolvePersonalizedCollection(request, curatedUrl, count);
    const products = [...result.products]
      .filter((product) => product.market.inventory > 0)
      .sort(sort)
      .slice(0, count);
    return json(response, 200, {
      products,
      source: result.source,
      generatedOnDemand: !result.cached,
      persona: result.persona,
      provenance: result.provenance
    }, { "cache-control": "no-store" });
  } catch (error) {
    return json(response, 502, { error: error.message || "Product collection failed" });
  }
}

async function requireCommerceUser(request, response) {
  const auth = await requireAuthedUser(request, response);
  if (!auth) return null;
  const commerce = await getCommerceStore();
  if (!commerce) {
    json(response, 503, { error: "Commerce storage is unavailable. Configure Turso to enable carts and checkout." });
    return null;
  }
  return { ...auth, commerce };
}

async function handleCartGet(request, response) {
  const auth = await requireCommerceUser(request, response);
  if (!auth) return;
  try {
    return json(response, 200, await auth.commerce.getCart(auth.user.id), { "cache-control": "no-store" });
  } catch (error) {
    return json(response, 502, { error: error.message || "Could not load cart" });
  }
}

async function handleCartAdd(request, response) {
  const auth = await requireCommerceUser(request, response);
  if (!auth) return;
  try {
    return json(response, 200, await auth.commerce.addCartItem(auth.user.id, await readJson(request)), { "cache-control": "no-store" });
  } catch (error) {
    return json(response, error.status || 502, { error: error.message || "Could not update cart" });
  }
}

async function handleCartRemove(request, response, itemId) {
  const auth = await requireCommerceUser(request, response);
  if (!auth) return;
  try {
    return json(response, 200, await auth.commerce.removeCartItem(auth.user.id, itemId), { "cache-control": "no-store" });
  } catch (error) {
    return json(response, error.status || 502, { error: error.message || "Could not update cart" });
  }
}

async function handleWalletGet(request, response) {
  const auth = await requireCommerceUser(request, response);
  if (!auth) return;
  try {
    return json(response, 200, await auth.commerce.getWallet(auth.user.id), { "cache-control": "no-store" });
  } catch (error) {
    return json(response, 502, { error: error.message || "Could not load wallet" });
  }
}

async function handleWalletTopUp(request, response) {
  const auth = await requireCommerceUser(request, response);
  if (!auth) return;
  try {
    const input = await readJson(request);
    return json(response, 200, await auth.commerce.topUpWallet(auth.user.id, input.amount, input.metadata || {}), { "cache-control": "no-store" });
  } catch (error) {
    return json(response, error.status || 502, { error: error.message || "Could not add funds" });
  }
}

async function handleWalletTransactions(request, response) {
  const auth = await requireCommerceUser(request, response);
  if (!auth) return;
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const limit = Number(url.searchParams.get("limit") || 50);
    return json(response, 200, { transactions: await auth.commerce.listWalletTransactions(auth.user.id, limit) }, { "cache-control": "no-store" });
  } catch (error) {
    return json(response, 502, { error: error.message || "Could not load transactions" });
  }
}

async function handleCheckout(request, response) {
  const auth = await requireCommerceUser(request, response);
  if (!auth) return;
  try {
    return json(response, 200, await auth.commerce.checkout(auth.user.id, await readJson(request)), { "cache-control": "no-store" });
  } catch (error) {
    return json(response, error.status || 502, { error: error.message || "Could not checkout" });
  }
}

async function handleOrdersList(request, response) {
  const auth = await requireCommerceUser(request, response);
  if (!auth) return;
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const limit = Number(url.searchParams.get("limit") || 20);
    return json(response, 200, { orders: await auth.commerce.listOrders(auth.user.id, limit) }, { "cache-control": "no-store" });
  } catch (error) {
    return json(response, 502, { error: error.message || "Could not load orders" });
  }
}

async function handleOrderGet(request, response, orderId) {
  const auth = await requireCommerceUser(request, response);
  if (!auth) return;
  try {
    const order = await auth.commerce.getOrder(auth.user.id, orderId);
    if (!order) return json(response, 404, { error: "Order not found" });
    return json(response, 200, order, { "cache-control": "no-store" });
  } catch (error) {
    return json(response, 502, { error: error.message || "Could not load order" });
  }
}

async function handleOrderStatus(request, response, orderId) {
  const auth = await requireCommerceUser(request, response);
  if (!auth) return;
  try {
    const status = await auth.commerce.getOrderStatus(auth.user.id, orderId);
    if (!status) return json(response, 404, { error: "Order not found" });
    return json(response, 200, status, { "cache-control": "no-store" });
  } catch (error) {
    return json(response, 502, { error: error.message || "Could not load order status" });
  }
}

async function handleSellingFast(request, url, response) {
  return handleCuratedCollection(request, url, response, {
    count: 6,
    sort: compareSalesVelocity
  });
}

async function handleFeatured(request, url, response) {
  return handleCuratedCollection(request, url, response, {
    count: 1,
    sort: compareFeatured
  });
}

async function handleStream(request, url, response) {
  const { query, limit, persona: initialPersona } = parseSearch(url);
  let persona = initialPersona;
  if (!query) return json(response, 400, { error: "q is required" });

  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive"
  });
  const send = (name, payload) => response.write(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);

  send("status", { phase: "searching", query, persona });
  try {
    const { products, source, cached, provenance, persona: resolvedPersona } = await resolvePersonalizedCollection(request, url);
    persona = resolvedPersona;
    send("status", { phase: cached ? "catalog-hit" : "sourced", query, persona });
    for (const product of products) send("product", product);
    send("done", { count: products.length, source, persona, provenance });
  } catch (error) {
    send("error", { message: error.message || "Product search failed" });
  } finally {
    response.end();
  }
}

async function handleShelf(request, url, response) {
  const { query, limit, persona: initialPersona } = parseSearch(url);
  let persona = initialPersona;
  if (!query) return json(response, 400, { error: "q is required" });

  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive"
  });
  const send = (name, payload) => response.write(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);

  send("status", { phase: "building-shelf", query, persona });
  try {
    const { products, source, cached, provenance, persona: resolvedPersona } = await resolvePersonalizedCollection(request, url, 12);
    persona = resolvedPersona;
    const rows = buildShelfRows(products);
    for (const row of rows) {
      send("shelf-row", { ...row, persona, provenance, source, cached });
    }
    send("done", { rows: rows.length, count: products.length, source, persona, provenance });
  } catch (error) {
    send("error", { message: error.message || "Shelf generation failed" });
  } finally {
    response.end();
  }
}

async function handleCompare(request, url, response) {
  const { query, limit, persona: initialPersona } = parseSearch(url);
  let persona = initialPersona;
  const requestedCount = Number(url.searchParams.get("count") || 4);
  const count = Math.min(Math.max(Number.isFinite(requestedCount) ? requestedCount : 4, 2), 4);
  const ids = url.searchParams.get("ids")?.split(",").map((id) => id.trim()).filter(Boolean) || [];
  if (!query) return json(response, 400, { error: "q is required" });

  try {
    const { products, source, cached, provenance, persona: resolvedPersona } = await resolvePersonalizedCollection(request, url, count);
    persona = resolvedPersona;
    const selected = ids.length
      ? products.filter((product) => ids.includes(product.id)).slice(0, count)
      : products.slice(0, count);
    const comparison = buildCompareVerdicts(selected.length >= 2 ? selected : products.slice(0, count));
    return json(response, 200, {
      products: comparison.ranked,
      verdicts: comparison.verdicts,
      persona,
      provenance,
      source,
      generatedOnDemand: !cached
    }, { "cache-control": "no-store" });
  } catch (error) {
    return json(response, 502, { error: error.message || "Comparison failed" });
  }
}

export async function handleRequest(request, response) {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true });
    if (request.method === "GET" && url.pathname === "/openapi.json") return json(response, 200, getOpenApiDocument(), { "cache-control": "no-store" });
    if (request.method === "GET" && url.pathname === "/docs") return html(response, 200, getDocsHtml(), { "cache-control": "no-store" });
    if (request.method === "GET" && url.pathname === "/economy") return html(response, 200, getEconomyHtml(), { "cache-control": "no-store" });
    if (request.method === "POST" && url.pathname === "/api/users/register") return handleRegistration(request, response);
    if (request.method === "POST" && url.pathname === "/api/users/login") return handleLogin(request, response);
    if (request.method === "POST" && url.pathname === "/api/users/logout") return handleLogout(request, response);
    if (request.method === "GET" && url.pathname === "/api/users/me") return handleCurrentUser(request, response);
    if (request.method === "PUT" && url.pathname === "/api/users/me") return handleProfileUpdate(request, response);
    if (request.method === "GET" && (url.pathname === "/api/products/search" || url.pathname === "/v1/products/search")) {
      return handleSearch(request, url, response);
    }
    if (request.method === "GET" && url.pathname === "/api/products/selling-fast") return handleSellingFast(request, url, response);
    if (request.method === "GET" && url.pathname === "/api/products/featured") return handleFeatured(request, url, response);
    if (request.method === "GET" && url.pathname === "/api/cart") return handleCartGet(request, response);
    if (request.method === "POST" && url.pathname === "/api/cart/items") return handleCartAdd(request, response);
    if (request.method === "DELETE" && url.pathname.startsWith("/api/cart/items/")) {
      return handleCartRemove(request, response, decodeURIComponent(url.pathname.slice("/api/cart/items/".length)));
    }
    if (request.method === "GET" && url.pathname === "/api/wallet") return handleWalletGet(request, response);
    if (request.method === "POST" && url.pathname === "/api/wallet/topup") return handleWalletTopUp(request, response);
    if (request.method === "GET" && url.pathname === "/api/wallet/transactions") return handleWalletTransactions(request, response);
    if (request.method === "POST" && url.pathname === "/api/checkout") return handleCheckout(request, response);
    if (request.method === "GET" && url.pathname === "/api/orders") return handleOrdersList(request, response);
    if (request.method === "GET" && /^\/api\/orders\/[^/]+\/status$/.test(url.pathname)) {
      return handleOrderStatus(request, response, decodeURIComponent(url.pathname.slice("/api/orders/".length, -"/status".length)));
    }
    if (request.method === "GET" && /^\/api\/orders\/[^/]+$/.test(url.pathname)) {
      return handleOrderGet(request, response, decodeURIComponent(url.pathname.slice("/api/orders/".length)));
    }
    if (request.method === "GET" && url.pathname === "/api/products/stream") {
      return handleStream(request, url, response);
    }
    if (request.method === "GET" && url.pathname === "/api/products/shelf") {
      return handleShelf(request, url, response);
    }
    if (request.method === "GET" && url.pathname === "/api/products/compare") {
      return handleCompare(request, url, response);
    }
    return json(response, 404, { error: "Not found" });
  } catch (error) {
    return json(response, error.status || 500, { error: error.message || "Internal server error" });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = http.createServer(handleRequest);
  server.listen(port, () => console.log(`Product Discovery Service listening on http://localhost:${port}`));
}
