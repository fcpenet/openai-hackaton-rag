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

function pick(random, items) {
  return items[Math.floor(random() * items.length)];
}

function titleCase(value) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

const personaConfigs = {
  normal: {
    category: "General Merchandise",
    nouns: ["Kit", "Pack", "Tool", "Accessory", "Set", "Bundle"],
    adjectives: ["Practical", "Reliable", "Compact", "Everyday", "Versatile", "Useful"],
    useCases: [
      "daily use",
      "travel",
      "a new workspace",
      "weekend projects",
      "gift-giving",
      "lightweight carry"
    ],
    finishes: ["matte", "soft-touch", "brushed", "clean-lined", "weathered", "high-contrast"]
  },
  luxury: {
    category: "Luxury Finds",
    nouns: ["Edition", "Case", "Carryall", "Suite", "Set", "Instrument"],
    adjectives: ["Polished", "Tailored", "Elevated", "Refined", "Signature", "Premium"],
    useCases: [
      "business travel",
      "a polished desk",
      "gifting with taste",
      "premium everyday carry",
      "quiet attention",
      "careful presentation"
    ],
    finishes: ["satin", "brushed gold", "soft leather", "high-gloss", "precision-milled", "velvet matte"]
  },
  bargain: {
    category: "Budget Finds",
    nouns: ["Pack", "Deal", "Saver", "Combo", "Kit", "Bundle"],
    adjectives: ["Budget", "Sharp", "No-Frills", "Value", "Practical", "Steady"],
    useCases: [
      "keeping costs down",
      "daily errands",
      "fast replacements",
      "low-risk testing",
      "simple upgrades",
      "stretching a budget"
    ],
    finishes: ["plain", "matte", "durable", "simple", "workhorse", "lightweight"]
  },
  minimalist: {
    category: "Minimal Essentials",
    nouns: ["Tool", "Piece", "Core", "Unit", "Form", "Set"],
    adjectives: ["Clean", "Quiet", "Reduced", "Simple", "Bare", "Slim"],
    useCases: [
      "a tidy desk",
      "a calmer routine",
      "low-clutter living",
      "quiet organization",
      "essential carry",
      "plain functionality"
    ],
    finishes: ["soft matte", "stone", "sand", "paper-white", "low-profile", "monochrome"]
  }
};

function keywordGroup(query) {
  const text = query.toLowerCase();
  if (/\b(phone|smartphone|mobile|iphone|android)\b/.test(text)) {
    return {
      category: "Electronics",
      nouns: ["Phone", "Case", "Screen Protector", "Charging Dock", "Power Bank", "Audio Adapter"],
      adjectives: ["Compact", "Refined", "Pocketable", "Fast-Charge", "Everyday", "Travel"]
    };
  }
  if (/\b(headphone|headset|earbud|speaker|audio)\b/.test(text)) {
    return {
      category: "Audio",
      nouns: ["Headphones", "Earbuds", "Speaker", "Sound Pod", "Travel Amp", "Mic Set"],
      adjectives: ["Immersive", "Balanced", "Compact", "Bass-First", "Studio", "Wireless"]
    };
  }
  if (/\b(laptop|computer|keyboard|mouse|monitor|screen)\b/.test(text)) {
    return {
      category: "Computing",
      nouns: ["Keyboard", "Mouse", "Stand", "Dock", "Hub", "Power Pack"],
      adjectives: ["Precision", "Portable", "Quiet", "Slim", "Workday", "Desk"]
    };
  }
  if (/\b(shoe|sneaker|boot|shirt|jacket|dress|bag|backpack)\b/.test(text)) {
    return {
      category: "Apparel",
      nouns: ["Bag", "Jacket", "Sneakers", "Shirt", "Pouch", "Carry Case"],
      adjectives: ["Everyday", "Lightweight", "Weatherproof", "Field", "Soft", "Utility"]
    };
  }
  if (/\b(book|novel|guide|manual|journal)\b/.test(text)) {
    return {
      category: "Books",
      nouns: ["Guide", "Notebook", "Reader", "Companion", "Set", "Edition"],
      adjectives: ["Pocket", "Curated", "Field", "Compact", "Reference", "Travel"]
    };
  }
  return personaConfigs.normal;
}

function resolvePersonaConfig(persona) {
  return personaConfigs[normalizePersona(persona)] || personaConfigs.normal;
}

function simulatedPrice(seedText) {
  let value = 0;
  for (const char of seedText) value = (value * 31 + char.charCodeAt(0)) >>> 0;
  return 499 + (value % 75_000);
}

function buildDescription(baseLabel, category, useCase) {
  return `An on-demand ${category.toLowerCase()} item for ${useCase}, shaped around ${baseLabel.toLowerCase()}.`;
}

export function createOnDemandCollection(query, limit = 12, { persona = "normal" } = {}) {
  const baseLabel = titleCase(query) || "Curious Item";
  const random = seededRandom(hash(`generated:${query}`));
  const normalizedPersona = normalizePersona(persona);
  const group = normalizedPersona === "normal"
    ? keywordGroup(query)
    : { ...keywordGroup(query), ...resolvePersonaConfig(normalizedPersona) };
  const archetypes = [
    "Pro",
    "Mini",
    "Max",
    "Lite",
    "Travel",
    "Starter",
    "Bundle",
    "Edition"
  ];
  const useCases = [
    "daily use",
    "travel",
    "a new workspace",
    "weekend projects",
    "gift-giving",
    "lightweight carry"
  ];
  const finishes = [
    "matte",
    "soft-touch",
    "brushed",
    "clean-lined",
    "weathered",
    "high-contrast"
  ];

  return Array.from({ length: limit }, (_, index) => {
    const archetype = pick(random, archetypes);
    const adjective = pick(random, group.adjectives);
    const noun = pick(random, group.nouns);
    const useCase = pick(random, useCases);
    const finish = pick(random, finishes);
    const title = `${adjective} ${baseLabel} ${noun} ${archetype}`;
    const description = `${buildDescription(baseLabel, group.category, useCase)} It has a ${finish} finish and a ${noun.toLowerCase()}-first shape.`;
    const idSeed = `${query}:${index}`;
    const reviews = createReviews(`generated:${idSeed}`, title, description, { mode: normalizedPersona === "intergalactic" ? "alien" : "normal" });

    return {
      id: `generated:${hash(idSeed).toString(36)}:${index + 1}`,
      title,
      description,
      category: group.category,
      imageUrl: createProductImage(title, description),
      persona: normalizedPersona,
      explanation: buildExplanation({ query, persona: normalizedPersona, title, category: group.category, description }),
      ...reviews,
      price: { amount: simulatedPrice(idSeed), currency: "PHP", isSimulated: true },
      source: {
        provider: "on-demand-catalog",
        itemId: `OD-${hash(idSeed).toString(36).toUpperCase()}`,
        url: `https://generated.example/items/${encodeURIComponent(idSeed)}`,
        retrievedAt: new Date(Date.UTC(2024, 0, 1) + index * 60 * 60 * 1000).toISOString(),
        license: "synthetic"
      }
    };
  });
}
