const personaLabels = {
  normal: "normal store",
  intergalactic: "intergalactic mart",
  luxury: "luxury storefront",
  bargain: "bargain warehouse",
  minimalist: "handpicked minimalist shop"
};

const personaHints = {
  normal: ["practical", "everyday", "balanced", "reliable"],
  intergalactic: ["earth disguise", "first contact", "translator", "mothership"],
  luxury: ["polished", "refined", "premium", "tailored"],
  bargain: ["value", "discount", "budget", "deal"],
  minimalist: ["clean", "pared back", "simple", "quiet"]
};

const englishDictionary = [
  "milk", "tea", "cup", "cups", "mug", "bottle", "bottles", "desk", "lamp", "chair", "table",
  "book", "books", "guide", "manual", "notebook", "phone", "smartphone", "mobile", "android", "iphone",
  "headphone", "headphones", "earbud", "earbuds", "speaker", "audio", "laptop", "computer", "keyboard",
  "mouse", "monitor", "screen", "case", "cover", "charger", "cable", "bag", "backpack", "wallet",
  "watch", "shoe", "shoes", "sneaker", "sneakers", "boot", "boots", "shirt", "jacket", "dress",
  "pouch", "pack", "kit", "bundle", "set", "accessory", "tool", "travel", "portable", "wireless",
  "compact", "reliable", "useful", "practical", "clean", "simple", "quiet", "premium", "budget", "value",
  "decent", "quality", "storage", "organizer", "adapter", "stand", "dock", "hub", "power", "light"
];

function levenshtein(left, right) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const temp = previous[j];
      const substitution = diagonal + (left[i - 1] === right[j - 1] ? 0 : 1);
      const insertion = previous[j - 1] + 1;
      const deletion = previous[j] + 1;
      previous[j] = Math.min(substitution, insertion, deletion);
      diagonal = temp;
    }
  }
  return previous[right.length];
}

function correctWord(word) {
  const cleaned = word.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!cleaned || cleaned.length < 3 || /\d/.test(cleaned)) return word;
  let best = cleaned;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of englishDictionary) {
    const distance = levenshtein(cleaned, candidate);
    if (distance < bestDistance || (distance === bestDistance && candidate.length < best.length)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  if (bestDistance <= 2 || (cleaned.length >= 6 && bestDistance <= 3)) return best;
  return cleaned;
}

export function correctSearchQuery(query, persona = "normal") {
  if (!query) return query;
  if (normalizePersona(persona) === "intergalactic") return query;
  return query
    .split(/(\s+)/)
    .map((part) => (/\s+/.test(part) ? part : correctWord(part)))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePersona(persona) {
  return Object.prototype.hasOwnProperty.call(personaLabels, persona) ? persona : "normal";
}

export function personaLabel(persona) {
  return personaLabels[normalizePersona(persona)];
}

export function buildSignals(query) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, 4);
}

export function buildExplanation({ query, persona, title, category, description }) {
  const hints = personaHints[normalizePersona(persona)];
  const signals = buildSignals(query);
  const signalText = signals.length
    ? signals.slice(0, 3).join(", ")
    : "the search intent";
  const personaText = personaLabel(persona);
  const categoryText = category ? category.toLowerCase() : "general merchandise";
  const titleText = title ? ` The title leans into ${title.toLowerCase()}.` : "";
  const descriptionText = description ? ` The description emphasizes ${description.toLowerCase()}.` : "";
  return `This item exists because the query points toward ${signalText}, so the ${personaText} generator biased toward ${hints[0]}, ${hints[1]}, and ${categoryText}.${titleText}${descriptionText}`;
}

export function repairGeneratedProduct(product, { query, persona, cached = false }) {
  const reviews = Array.isArray(product.reviews) ? product.reviews.filter(Boolean) : [];
  const reviewCount = reviews.length;
  const averageRating = reviewCount
    ? Math.round(reviews.reduce((sum, review) => sum + (Number(review.rating) || 0), 0) / reviewCount)
    : null;

  return {
    ...product,
    persona: product.persona || normalizePersona(persona),
    explanation: product.explanation || buildExplanation({
      query,
      persona,
      title: product.title,
      category: product.category,
      description: product.description
    }),
    provenance: product.provenance || {
      query,
      persona: normalizePersona(persona),
      cached
    },
    rating: product.rating ?? averageRating,
    reviewCount: product.reviewCount ?? reviewCount,
    reviews
  };
}

function productScore(product) {
  const rating = Number(product.rating ?? 0);
  const reviewCount = Number(product.reviewCount ?? 0);
  const price = Number(product.price?.amount ?? 0);
  return (rating * 1000) + Math.min(reviewCount * 5, 500) - Math.min(price / 10, 750);
}

function uniquenessScore(product) {
  const title = product.title || "";
  const reviewCount = Number(product.reviewCount ?? 0);
  return (title.length * 3) + Math.abs(reviewCount - 42);
}

function shippingScore(product) {
  const rating = Number(product.rating ?? 0);
  const price = Number(product.price?.amount ?? 0);
  return (rating * 50) + Math.max(0, 1200 - Math.min(price, 1200));
}

function giftScore(product) {
  const rating = Number(product.rating ?? 0);
  const reviewCount = Number(product.reviewCount ?? 0);
  return (rating * 100) + Math.min(reviewCount, 200);
}

function priceScore(product) {
  const price = Number(product.price?.amount ?? 0);
  const rating = Number(product.rating ?? 0);
  return (rating * 60) - price;
}

function uniqueProducts(products) {
  const seen = new Set();
  return products.filter((product) => {
    if (seen.has(product.id)) return false;
    seen.add(product.id);
    return true;
  });
}

export function buildShelfRows(products) {
  const unique = uniqueProducts(products);
  const bestFit = [...unique].sort((a, b) => productScore(b) - productScore(a)).slice(0, 3);
  const cheapButDecent = [...unique]
    .sort((a, b) => (priceScore(b) - priceScore(a)))
    .filter((product) => Number(product.rating ?? 0) >= 3)
    .slice(0, 3);
  const weirdlyGood = [...unique].sort((a, b) => uniquenessScore(b) - uniquenessScore(a)).slice(0, 3);
  const backupOption = [...unique]
    .sort((a, b) => shippingScore(b) - shippingScore(a))
    .slice(-3)
    .reverse();

  return [
    { key: "best-fit", label: "Best fit", products: bestFit },
    { key: "cheap-but-decent", label: "Cheap but decent", products: cheapButDecent },
    { key: "weirdly-good", label: "Weirdly good", products: weirdlyGood },
    { key: "backup-option", label: "Backup option", products: backupOption }
  ].filter((row) => row.products.length > 0);
}

export function buildCompareVerdicts(products) {
  const unique = uniqueProducts(products);
  const ranked = [...unique].sort((a, b) => productScore(b) - productScore(a));
  const byGift = [...unique].sort((a, b) => giftScore(b) - giftScore(a));
  const byShipping = [...unique].sort((a, b) => shippingScore(b) - shippingScore(a));
  const byValue = [...unique].sort((a, b) => priceScore(b) - priceScore(a));

  const bestValue = byValue[0] || null;
  const bestGift = byGift[0] || null;
  const mostSuspicious = [...unique].sort((a, b) => uniquenessScore(b) - uniquenessScore(a))[0] || null;
  const mostLikelyToSurviveShipping = byShipping[0] || null;

  return {
    ranked,
    verdicts: {
      bestValue: bestValue ? { product: bestValue, reason: "highest value balance" } : null,
      bestGift: bestGift ? { product: bestGift, reason: "best crowd-pleaser score" } : null,
      mostSuspicious: mostSuspicious ? { product: mostSuspicious, reason: "oddly specific shape and naming" } : null,
      mostLikelyToSurviveShipping: mostLikelyToSurviveShipping ? { product: mostLikelyToSurviveShipping, reason: "highest shipping resilience score" } : null
    }
  };
}
