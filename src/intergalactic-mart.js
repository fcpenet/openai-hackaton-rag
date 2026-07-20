import { createProductImage, createReviews } from "./product-presentation.js";
import { buildExplanation, normalizePersona } from "./product-intelligence.js";

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

function shuffled(random, items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function simulatedPrice(seedText) {
  const random = seededRandom(hash(`price:${seedText}`));
  const bands = [
    { floor: 799, span: 8_000 },
    { floor: 9_000, span: 18_000 },
    { floor: 28_000, span: 32_000 },
    { floor: 60_000, span: 55_000 },
    { floor: 120_000, span: 95_000 },
    { floor: 225_000, span: 160_000 }
  ];
  const band = bands[Math.floor(random() * bands.length)];
  return band.floor + Math.floor(random() * band.span);
}

function createAlienQueryLabel(query) {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

export function createIntergalacticCollection(query, limit = 12, { persona = "intergalactic" } = {}) {
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
  const variantAdjectives = shuffled(random, adjectives);
  const variantNouns = shuffled(random, nouns);
  const variantUseCases = shuffled(random, useCases);
  const variantFinishes = shuffled(random, finishes);

  return Array.from({ length: limit }, (_, index) => {
    const itemSeed = `${query}:${index}`;
    const adjective = variantAdjectives[index % variantAdjectives.length];
    const noun = variantNouns[index % variantNouns.length];
    const finish = variantFinishes[Math.floor(index / variantUseCases.length) % variantFinishes.length];
    const useCase = variantUseCases[index % variantUseCases.length];
    const title = `${adjective} ${noun}`;
    const description = `A ${finish} ${noun.toLowerCase()} for ${useCase}.`;
    const reviews = createReviews(`intergalactic:${itemSeed}`, title, description, { mode: "alien" });
    const normalizedPersona = normalizePersona(persona) === "normal" ? "intergalactic" : normalizePersona(persona);
    const rank = 1 + index;
    return {
      id: `intergalactic:${hash(itemSeed).toString(36)}:${rank}`,
      title: `${title} ${rank}`,
      description: `${description} Inspired by ${baseLabel.toLowerCase()} search intent. Orbital registry variant ${rank}.`,
      category: "Intergalactic Mart",
      imageUrl: createProductImage(`${title} ${rank}`, `${description} Variant ${rank}.`, itemSeed),
      persona: normalizedPersona,
      explanation: buildExplanation({ query, persona: normalizedPersona, title, category: "Intergalactic Mart", description }),
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
