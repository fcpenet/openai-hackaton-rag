const DAY_MS = 24 * 60 * 60 * 1000;

function hash(value) {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function randomFrom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function marketDay(now) {
  return Math.floor(now.getTime() / DAY_MS);
}

function trendFrom(momentum) {
  if (momentum >= 0.18) return "rising";
  if (momentum <= -0.18) return "cooling";
  return "steady";
}

// This is deterministic within a UTC day: every request sees the same market
// state, then the market advances naturally when the next UTC day begins.
export function simulateMarket(product, { now = new Date() } = {}) {
  const day = marketDay(now);
  const baselineRandom = randomFrom(hash(`market:base:${product.id}`));
  const dailyRandom = randomFrom(hash(`market:day:${day}:${product.id}`));
  const baselineDemand = 18 + Math.floor(baselineRandom() * 140);
  const momentum = Math.round((dailyRandom() - 0.5) * 80) / 100;
  const inventory = 8 + Math.floor(baselineRandom() * 180);
  const salesVelocity = Math.max(1, Math.round(baselineDemand * (0.75 + dailyRandom() * 0.7) * (1 + momentum)));
  const unitsSold = Math.max(salesVelocity, Math.round(salesVelocity * (4 + baselineRandom() * 18)));
  const quality = Number(product.rating || 3);
  const availability = Math.min(inventory, 60) / 60;
  const value = Math.max(0, 1 - Math.min(Number(product.price?.amount || 0), 80_000) / 100_000);
  const demandScore = Math.round(salesVelocity * (1 + momentum) * 10);
  const featuredScore = Math.round((demandScore * 0.52) + (quality * 100 * 0.25) + (availability * 100 * 0.13) + (value * 100 * 0.1));

  return {
    day: new Date(day * DAY_MS).toISOString().slice(0, 10),
    source: "seeded",
    inventory,
    unitsSold,
    salesVelocity,
    demandScore,
    featuredScore,
    trend: trendFrom(momentum)
  };
}

export function enrichWithMarket(product, options) {
  return { ...product, market: simulateMarket(product, options) };
}

export function compareSalesVelocity(left, right) {
  return (right.market.salesVelocity - left.market.salesVelocity)
    || (right.market.demandScore - left.market.demandScore)
    || left.id.localeCompare(right.id);
}

export function compareFeatured(left, right) {
  return (right.market.featuredScore - left.market.featuredScore)
    || (right.market.salesVelocity - left.market.salesVelocity)
    || left.id.localeCompare(right.id);
}
