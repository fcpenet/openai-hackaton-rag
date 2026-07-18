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
