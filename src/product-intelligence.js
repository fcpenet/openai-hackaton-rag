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
