import test from "node:test";
import assert from "node:assert/strict";
import { simulateMarket } from "../src/market-economy.js";

const product = {
  id: "generated:market-test:1",
  rating: 4,
  price: { amount: 4_999, currency: "PHP" }
};

test("market state is stable within a UTC day and advances on the next day", () => {
  const morning = simulateMarket(product, { now: new Date("2026-07-19T01:00:00.000Z") });
  const evening = simulateMarket(product, { now: new Date("2026-07-19T23:59:59.000Z") });
  const tomorrow = simulateMarket(product, { now: new Date("2026-07-20T01:00:00.000Z") });

  assert.deepEqual(evening, morning);
  assert.equal(morning.day, "2026-07-19");
  assert.equal(morning.source, "seeded");
  assert.equal(tomorrow.day, "2026-07-20");
  assert.notDeepEqual(tomorrow, morning);
});
