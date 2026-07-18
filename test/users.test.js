import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { UserStore, validateRegistration } from "../src/users.js";
import { handleRequest, setUserStoreForTesting } from "../src/product-api.js";

function createUserClient() {
  const users = new Map();
  const sessions = new Map();
  return {
    async execute(statement) {
      if (typeof statement === "string") return { rows: [] };
      const { sql, args } = statement;
      if (sql.startsWith("INSERT INTO users")) {
        const [, email] = args;
        if (users.has(email)) throw new Error("UNIQUE constraint failed: users.email");
        users.set(email, { id: args[0], email, display_name: args[2], password_hash: args[3], created_at: args[4] });
        return { rows: [] };
      }
      if (sql.includes("FROM users WHERE email")) return { rows: users.has(args[0]) ? [users.get(args[0])] : [] };
      if (sql.startsWith("INSERT INTO user_sessions")) {
        sessions.set(args[2], { user_id: args[1], expires_at: args[3] });
        return { rows: [] };
      }
      if (sql.includes("FROM user_sessions JOIN users")) {
        const session = sessions.get(args[0]);
        if (!session || session.expires_at <= args[1]) return { rows: [] };
        const user = [...users.values()].find((candidate) => candidate.id === session.user_id);
        return { rows: user ? [user] : [] };
      }
      if (sql.startsWith("DELETE FROM user_sessions")) {
        sessions.delete(args[0]);
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
}

function response() {
  return {
    statusCode: 0,
    body: "",
    writeHead(status) { this.statusCode = status; },
    end(body = "") { this.body = body; }
  };
}

async function request(method, url, { body, token } = {}) {
  const result = response();
  await handleRequest({
    method,
    url,
    body,
    headers: { host: "localhost:3000", ...(token ? { authorization: `Bearer ${token}` } : {}) }
  }, result);
  return { ...result, json: result.body ? JSON.parse(result.body) : undefined };
}

afterEach(() => setUserStoreForTesting());

test("validates registration input", () => {
  assert.equal(validateRegistration({ email: "not-an-email", password: "12345678" }), "A valid email is required");
  assert.equal(validateRegistration({ email: "a@example.com", password: "short" }), "Password must be at least 8 characters");
  assert.equal(validateRegistration({ email: "a@example.com", password: "12345678", displayName: "x".repeat(81) }), "Display name must be 1 to 80 characters");
  assert.equal(validateRegistration({ email: "A@EXAMPLE.COM", password: "12345678" }), undefined);
});

test("user store creates accounts, hashes passwords, and manages sessions", async () => {
  const store = new UserStore({ client: createUserClient() });
  const user = await store.register({ email: "Ada@Example.com", displayName: "Ada", password: "secure-pass" });
  assert.deepEqual(Object.keys(user).sort(), ["createdAt", "displayName", "email", "id"]);
  assert.equal(user.email, "ada@example.com");
  await assert.rejects(
    store.register({ email: "ada@example.com", password: "different-pass" }),
    (error) => error.code === "EMAIL_TAKEN"
  );
  assert.equal(await store.login({ email: user.email, password: "wrong-pass" }), undefined);
  const login = await store.login({ email: user.email, password: "secure-pass" });
  assert.ok(login.token.length > 30);
  assert.deepEqual(await store.getUserForToken(login.token), user);
  await store.logout(login.token);
  assert.equal(await store.getUserForToken(login.token), undefined);
});

test("user endpoints support the full registration and session lifecycle", async () => {
  setUserStoreForTesting(new UserStore({ client: createUserClient() }));
  const invalid = await request("POST", "/api/users/register", { body: { email: "bad", password: "123" } });
  assert.equal(invalid.statusCode, 400);

  const registered = await request("POST", "/api/users/register", {
    body: { email: "user@example.com", password: "secure-pass", displayName: "Test User" }
  });
  assert.equal(registered.statusCode, 201);
  assert.equal(registered.json.user.displayName, "Test User");
  assert.ok(registered.json.token);

  const duplicate = await request("POST", "/api/users/register", {
    body: { email: "user@example.com", password: "secure-pass" }
  });
  assert.equal(duplicate.statusCode, 409);

  const denied = await request("POST", "/api/users/login", { body: { email: "user@example.com", password: "wrong-pass" } });
  assert.equal(denied.statusCode, 401);
  const login = await request("POST", "/api/users/login", { body: { email: "user@example.com", password: "secure-pass" } });
  assert.equal(login.statusCode, 200);

  const anonymous = await request("GET", "/api/users/me");
  assert.equal(anonymous.statusCode, 401);
  const current = await request("GET", "/api/users/me", { token: login.json.token });
  assert.equal(current.statusCode, 200);
  assert.equal(current.json.user.email, "user@example.com");

  const logout = await request("POST", "/api/users/logout", { token: login.json.token });
  assert.equal(logout.statusCode, 204);
  const expired = await request("GET", "/api/users/me", { token: login.json.token });
  assert.equal(expired.statusCode, 401);
});
