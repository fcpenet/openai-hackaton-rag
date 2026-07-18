import { createHash, pbkdf2, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { createClient } from "@libsql/client";

const deriveKey = promisify(pbkdf2);
const PASSWORD_ITERATIONS = 210_000;
const PASSWORD_KEY_LENGTH = 32;
const SESSION_DAYS = 30;

const setupSql = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS user_profiles (
    user_id TEXT PRIMARY KEY,
    persona TEXT NOT NULL DEFAULT 'normal',
    budget_min INTEGER,
    budget_max INTEGER,
    preferred_categories_json TEXT NOT NULL DEFAULT '[]',
    excluded_categories_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  "CREATE INDEX IF NOT EXISTS user_sessions_token_hash_idx ON user_sessions(token_hash)"
];

export class UserStore {
  constructor({ client } = {}) {
    this.client = client || this.#createClient();
    this.setup = null;
  }

  async register({ email, displayName, password }) {
    await this.#ensureSetup();
    const user = {
      id: randomUUID(),
      email: normalizeEmail(email),
      displayName: normalizeDisplayName(displayName, email),
      passwordHash: await hashPassword(password),
      createdAt: new Date().toISOString()
    };
    try {
      await this.client.execute({
        sql: "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
        args: [user.id, user.email, user.displayName, user.passwordHash, user.createdAt]
      });
    } catch (error) {
      if (String(error.message).toLowerCase().includes("unique")) {
        const duplicate = new Error("An account already exists for this email");
        duplicate.code = "EMAIL_TAKEN";
        throw duplicate;
      }
      throw error;
    }
    return this.#publicUser(user);
  }

  async login({ email, password }) {
    await this.#ensureSetup();
    const result = await this.client.execute({
      sql: "SELECT id, email, display_name, password_hash, created_at FROM users WHERE email = ?",
      args: [normalizeEmail(email)]
    });
    const user = result.rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) return undefined;
    return { user: this.#publicUser(rowToUser(user)), token: await this.#createSession(user.id) };
  }

  async getUserForToken(token) {
    await this.#ensureSetup();
    if (!token) return undefined;
    const result = await this.client.execute({
      sql: `SELECT users.id, users.email, users.display_name, users.created_at
            FROM user_sessions JOIN users ON users.id = user_sessions.user_id
            WHERE user_sessions.token_hash = ? AND user_sessions.expires_at > ?`,
      args: [tokenHash(token), new Date().toISOString()]
    });
    return result.rows[0] ? this.#publicUser(rowToUser(result.rows[0])) : undefined;
  }

  async getProfile(userId) {
    await this.#ensureSetup();
    const result = await this.client.execute({
      sql: "SELECT persona, budget_min, budget_max, preferred_categories_json, excluded_categories_json, updated_at FROM user_profiles WHERE user_id = ?",
      args: [userId]
    });
    return result.rows[0] ? rowToProfile(result.rows[0]) : defaultProfile();
  }

  async updateProfile(userId, input) {
    const validationError = validateProfile(input);
    if (validationError) {
      const error = new Error(validationError);
      error.status = 400;
      throw error;
    }
    const current = await this.getProfile(userId);
    const profile = {
      persona: input.persona === undefined ? current.persona : input.persona,
      budgetMin: input.budgetMin === undefined ? current.budgetMin : input.budgetMin,
      budgetMax: input.budgetMax === undefined ? current.budgetMax : input.budgetMax,
      preferredCategories: input.preferredCategories === undefined ? current.preferredCategories : normalizeCategories(input.preferredCategories),
      excludedCategories: input.excludedCategories === undefined ? current.excludedCategories : normalizeCategories(input.excludedCategories),
      updatedAt: new Date().toISOString()
    };
    await this.client.execute({
      sql: `INSERT INTO user_profiles (user_id, persona, budget_min, budget_max, preferred_categories_json, excluded_categories_json, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET persona = excluded.persona, budget_min = excluded.budget_min, budget_max = excluded.budget_max, preferred_categories_json = excluded.preferred_categories_json, excluded_categories_json = excluded.excluded_categories_json, updated_at = excluded.updated_at`,
      args: [userId, profile.persona, profile.budgetMin, profile.budgetMax, JSON.stringify(profile.preferredCategories), JSON.stringify(profile.excludedCategories), profile.updatedAt]
    });
    return profile;
  }

  async logout(token) {
    await this.#ensureSetup();
    if (token) await this.client.execute({ sql: "DELETE FROM user_sessions WHERE token_hash = ?", args: [tokenHash(token)] });
  }

  #publicUser(user) {
    return { id: user.id, email: user.email, displayName: user.displayName, createdAt: user.createdAt };
  }

  async #createSession(userId) {
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await this.client.execute({
      sql: "INSERT INTO user_sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
      args: [randomUUID(), userId, tokenHash(token), expiresAt, now.toISOString()]
    });
    return token;
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

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function validateRegistration({ email, password, displayName }) {
  const normalizedEmail = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return "A valid email is required";
  if (typeof password !== "string" || password.length < 8) return "Password must be at least 8 characters";
  if (displayName !== undefined && (typeof displayName !== "string" || displayName.trim().length > 80)) return "Display name must be 1 to 80 characters";
  return undefined;
}

export function validateProfile(input) {
  if (!input || typeof input !== "object") return "Profile must be an object";
  if (input.persona !== undefined && !["normal", "luxury", "bargain", "minimalist"].includes(input.persona)) return "Persona must be normal, luxury, bargain, or minimalist";
  for (const field of ["budgetMin", "budgetMax"]) {
    if (input[field] !== undefined && (!Number.isInteger(input[field]) || input[field] < 0)) return `${field} must be a non-negative integer`;
  }
  if (input.budgetMin !== undefined && input.budgetMax !== undefined && input.budgetMin > input.budgetMax) return "budgetMin cannot exceed budgetMax";
  for (const field of ["preferredCategories", "excludedCategories"]) {
    if (input[field] !== undefined && (!Array.isArray(input[field]) || input[field].length > 20 || input[field].some((value) => typeof value !== "string" || !value.trim() || value.length > 80))) return `${field} must be an array of up to 20 category names`;
  }
  return undefined;
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const hash = await deriveKey(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, "sha512");
  return `pbkdf2$sha512$${PASSWORD_ITERATIONS}$${salt}$${hash.toString("base64url")}`;
}

async function verifyPassword(password, encoded) {
  if (typeof password !== "string" || typeof encoded !== "string") return false;
  const [scheme, digest, iterations, salt, expected] = encoded.split("$");
  if (scheme !== "pbkdf2" || digest !== "sha512" || !salt || !expected) return false;
  const actual = await deriveKey(password, salt, Number(iterations), PASSWORD_KEY_LENGTH, "sha512");
  const expectedBuffer = Buffer.from(expected, "base64url");
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

function normalizeDisplayName(displayName, email) {
  const name = typeof displayName === "string" ? displayName.trim() : "";
  return name || normalizeEmail(email).split("@")[0];
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("base64url");
}

function rowToUser(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    createdAt: row.created_at
  };
}

function defaultProfile() {
  return { persona: "normal", budgetMin: null, budgetMax: null, preferredCategories: [], excludedCategories: [], updatedAt: null };
}

function rowToProfile(row) {
  return {
    persona: row.persona,
    budgetMin: row.budget_min ?? null,
    budgetMax: row.budget_max ?? null,
    preferredCategories: JSON.parse(row.preferred_categories_json || "[]"),
    excludedCategories: JSON.parse(row.excluded_categories_json || "[]"),
    updatedAt: row.updated_at
  };
}

function normalizeCategories(categories) {
  return [...new Set(categories.map((category) => category.trim()))];
}
