import test from "node:test";
import assert from "node:assert/strict";
import { Catalog } from "../src/catalog.js";

test("persists and retrieves a normalized collection by query", async () => {
  let stored;
  const client = {
    async execute(statement) {
      if (typeof statement === "string") return { rows: [] };
      if (statement.sql.startsWith("SELECT")) return { rows: stored ? [{ products_json: stored }] : [] };
      stored = statement.args[1];
      return { rows: [] };
    }
  };
  const catalog = new Catalog({ client });
  const products = [{ id: "generated:Q1", title: "Example" }];
  await catalog.set("  Example  ", products);
  assert.deepEqual(await catalog.get("example"), products);
});
