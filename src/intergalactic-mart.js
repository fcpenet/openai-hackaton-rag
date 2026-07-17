import { createProductImage, createReviews } from "./product-presentation.js";

function hash(value) {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(random, items) {
  return items[Math.floor(random() * items.length)];
}

function simulatedPrice(seedText) {
  let value = 0;
  for (const char of seedText) value = (value * 31 + char.charCodeAt(0)) >>> 0;
  return 799 + (value % 120_000);
}

function createAlienQueryLabel(query) {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

export function createIntergalacticCollection(query, limit = 12) {
  const random = seededRandom(hash(`intergalactic:${query}`));
  const baseLabel = createAlienQueryLabel(query) || "Curious Earth Thing";
  const adjectives = [
    "Quantum",
    "Suspiciously-Human",
    "Zero-Gravity",
    "Universal",
    "Orbit-Worn",
    "Gravity-Defying",
    "Astrograde",
    "Warp-Friendly",
    "Moonlit",
    "Cosmic"
  ];
  const nouns = [
    "Snack Dispenser",
    "Translation Pebble",
    "Pocket Nebula",
    "Travel Mug",
    "Sleep Capsule",
    "Field Lantern",
    "Repair Tape",
    "Rain Cloak",
    "Desk Companion",
    "Carry Pod"
  ];
  const useCases = [
    "commuting between moons",
    "blending in with earth retail crowds",
    "keeping a spaceship tidy",
    "surviving long orbital delays",
    "looking normal in daylight",
    "staying organized during a meteor season"
  ];
  const finishes = [
    "matte",
    "iridescent",
    "soft-touch",
    "vacuum-polished",
    "starlit",
    "earth-tone"
  ];

  return Array.from({ length: limit }, (_, index) => {
    const itemSeed = `${query}:${index}`;
    const adjective = pick(random, adjectives);
    const noun = pick(random, nouns);
    const finish = pick(random, finishes);
    const useCase = pick(random, useCases);
    const title = `${adjective} ${noun}`;
    const description = `A ${finish} ${noun.toLowerCase()} for ${useCase}.`;
    const reviews = createReviews(`intergalactic:${itemSeed}`, title, description, { mode: "alien" });
    const rank = 1 + index;
    return {
      id: `intergalactic:${hash(itemSeed).toString(36)}:${rank}`,
      title: `${title} ${rank}`,
      description: `${description} Inspired by ${baseLabel.toLowerCase()} search intent.`,
      category: "Intergalactic Mart",
      imageUrl: createProductImage(title, description),
      ...reviews,
      price: { amount: simulatedPrice(itemSeed), currency: "GCR", isSimulated: true },
      source: {
        provider: "intergalactic-mart",
        itemId: `IM-${hash(itemSeed).toString(36).toUpperCase()}`,
        url: `https://intergalactic.example/items/${encodeURIComponent(itemSeed)}`,
        retrievedAt: new Date(Date.UTC(2024, 0, 1) + index * 60 * 60 * 1000).toISOString(),
        license: "synthetic"
      }
    };
  });
}
