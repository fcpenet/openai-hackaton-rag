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

const reviewEpoch = Date.UTC(2024, 0, 1);

function escapeXml(value) {
  return value.replace(/[<>&"']/g, (character) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&apos;"
  })[character]);
}

function illustration(title, description) {
  const subject = `${title} ${description || ""}`.toLowerCase();
  if (/phone|smartphone|iphone/.test(subject)) {
    return '<rect x="116" y="30" width="168" height="260" rx="24" fill="#24324A"/><rect x="128" y="52" width="144" height="200" rx="12" fill="#B8E2F2"/><circle cx="200" cy="270" r="9" fill="#F4F7FA"/>';
  }
  if (/headphone|headset|earbud/.test(subject)) {
    return '<path d="M100 205V155a100 100 0 0 1 200 0v50" fill="none" stroke="#24324A" stroke-width="26" stroke-linecap="round"/><rect x="75" y="190" width="56" height="78" rx="20" fill="#E95D3C"/><rect x="269" y="190" width="56" height="78" rx="20" fill="#E95D3C"/>';
  }
  return '<rect x="86" y="78" width="228" height="184" rx="18" fill="#F2B441"/><path d="M86 128h228M200 78v184" stroke="#FFF7E8" stroke-width="12"/><circle cx="200" cy="170" r="24" fill="#24324A"/>';
}

export function createProductImage(title, description) {
  const label = escapeXml(title.slice(0, 48));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 340" role="img" aria-label="${label}"><rect width="400" height="340" fill="#FFF7E8"/>${illustration(title, description)}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function createReviewText(random, title, description, rating, index) {
  const opener = pick(random, [
    "Nice find",
    "Solid choice",
    "Happy with this",
    "Works as expected",
    "Good value"
  ]);
  const subject = title || description || "this item";
  const detail = description ? `The ${description.toLowerCase()} detail was about what I expected.` : `It matched the listing and felt close to the photos.`;
  const verdicts = {
    1: ["Felt underwhelming.", "I would not buy this again.", "The fit and finish were disappointing."],
    2: ["It did the job, but only barely.", "There were a few rough edges.", "I wish the quality had been better."],
    3: ["It is decent overall.", "A few compromises, but usable.", "Good enough for everyday use."],
    4: ["I would recommend it.", "Feels better than expected.", "A dependable pick for the price."],
    5: ["Exceeded my expectations.", "I would happily buy it again.", "This one feels like a great find."]
  };

  const closing = pick(random, verdicts[rating]);
  const addendum = index === 0 ? `It is the kind of ${subject.toLowerCase()} I wanted.` : pick(random, [
    "Shipping was fast enough.",
    "Packaging was clean and simple.",
    "The color and finish matched the listing.",
    "Setup was quick."
  ]);

  return `${opener}. ${detail} ${closing} ${addendum}`;
}

export function createReviews(id, title = "", description = "") {
  const count = hash(`${id}:reviews`) % 251;
  if (count === 0) {
    return {
      rating: null,
      reviewCount: 0,
      reviews: []
    };
  }

  const random = seededRandom(hash(`${id}:review-seed`));
  const reviews = Array.from({ length: count }, (_, index) => {
    const rating = 1 + Math.floor(random() * 5);
    const ageDays = Math.floor(random() * 730);
    const createdAt = new Date(reviewEpoch - ageDays * 24 * 60 * 60 * 1000).toISOString();
    const author = pick(random, [
      "Ava",
      "Noah",
      "Mia",
      "Liam",
      "Sofia",
      "Ethan",
      "Kai",
      "Zara"
    ]);
    return {
      id: `${id}:review:${index + 1}`,
      author,
      rating,
      title: pick(random, [
        "Worth it",
        "Pretty good",
        "Exactly what I needed",
        "Fine for the price",
        "Would buy again"
      ]),
      body: createReviewText(random, title, description, rating, index),
      createdAt
    };
  });

  return {
    rating: Math.round(reviews.reduce((total, review) => total + review.rating, 0) / reviews.length),
    reviewCount: count,
    reviews
  };
}

export function createReviewSummary(id, title = "", description = "") {
  const { rating, reviewCount } = createReviews(id, title, description);
  return { rating, reviewCount };
}
