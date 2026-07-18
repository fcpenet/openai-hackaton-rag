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

export function createReviewTitle(random, title, description, rating, index, mode) {
  const subject = (title || description || "this item").toLowerCase();
  const ratingTitles = mode === "alien"
    ? {
      1: [
        "First Contact, Bad Outcome",
        "Earth Commerce Misfire",
        "Suspiciously Not Great",
        "My Antennae Say No",
        "Human Retail Warning"
      ],
      2: [
        "Borderline Usable",
        "Almost Earth-Ready",
        "A Mildly Strange Purchase",
        "Not Fully Convincing",
        "Operational, Barely"
      ],
      3: [
        "Reasonably Earthlike",
        "Acceptable by Human Standards",
        "The Middle of the Galaxy",
        "Ordinary in a Good Way",
        "Serviceable Enough"
      ],
      4: [
        "Strong Earth Disguise Value",
        "Pleasantly Advanced",
        "Would Recommend to Visitors",
        "Good Human Cover Material",
        "Surprisingly Solid"
      ],
      5: [
        "A Triumph of Disguise",
        "Excellent Human Mimicry",
        "Mothership-Worthy",
        "Near-Perfect Earth Camouflage",
        "A Very Good Artifact"
      ]
    }
    : {
      1: [
        "Not My Favorite",
        "A Rough Start",
        "Needed More Work",
        "A Bit of a Miss",
        "Disappointing Out of the Box"
      ],
      2: [
        "Mostly Fine",
        "Could Be Better",
        "Only Half Convinced",
        "A Little Clunky",
        "Near the Line"
      ],
      3: [
        "Pretty Solid",
        "Exactly Average",
        "Does the Job",
        "Comfortably Ordinary",
        "No Complaints"
      ],
      4: [
        "Better Than Expected",
        "A Pleasant Surprise",
        "Would Buy Again",
        "Strong Value",
        "Genuinely Good"
      ],
      5: [
        "Excellent Find",
        "Worth the Hype",
        "Top Shelf",
        "Instant Favorite",
        "Very Happy With It"
      ]
    };

  const prefix = index === 0
    ? (mode === "alien" ? "First Encounter" : "First Impressions")
    : pick(random, mode === "alien"
      ? ["Unexpected Report", "Field Note", "Observed Behavior", "Transmission Log", "Quick Sighting"]
      : ["Quick Note", "Short Take", "Fresh Impressions", "Field Report", "Brief Verdict"]);

  const subjectTag = subject.length > 22 ? subject.slice(0, 22).trim() : subject;
  const chosen = pick(random, ratingTitles[rating]);
  return `${prefix}: ${chosen}${subjectTag ? ` on ${subjectTag}` : ""}`;
}

export function createReviewText(random, title, description, rating, index, mode) {
  const subject = title || description || "this item";
  const firstEncounter = mode === "alien" && index === 0;
  const tone = mode === "alien"
    ? {
      detail: description ? `The ${description.toLowerCase()} aspect registered cleanly in my cranial buffer.` : `Its appearance aligned with the images on your earth marketplace.`,
      opener: {
        1: ["I attempted earth-approval and failed.", "My species would classify this as a regret.", "This object made my antennae droop."],
        2: ["I remain polite, though only partly convinced.", "A serviceable artifact, but not celebrated in my home sector.", "My enthusiasm arrived late and left early."],
        3: ["Human commerce has done adequately here.", "I can understand why earthlings tolerate it.", "A reasonably average specimen from your planet."],
        4: ["I am learning your customs, and this helped.", "This item is extremely compatible with my earth disguise.", "A successful adaptation to human retail behavior."],
        5: ["I have achieved near-total assimilation through this purchase.", "This is the kind of item that helps me pass as human.", "My disguise matrix is grateful for this one."]
      },
      closing: {
        1: ["I will not be returning for another of these.", "My podmates advised me against it.", "This one failed the interstellar comfort test."],
        2: ["I can survive with it, though barely.", "It remains below acceptable planetary standards.", "My approval bubbles are lukewarm."],
        3: ["It is serviceable enough for earth integration.", "A normal outcome by human retail norms.", "I can see the appeal from a local perspective."],
        4: ["I would recommend it to other visitors.", "A helpful tool for blending in.", "The earth disguise value is strong."],
        5: ["I will report this back to the mothership as a success.", "A magnificent aid to human impersonation.", "This purchase may extend my stay on earth."]
      },
      firstAddendum: `This is my first close look at a ${subject.toLowerCase()}. It is disturbingly practical.`,
      otherAddendum: [
        "My translator had no complaints.",
        "The packaging looked very human.",
        "It arrived before my cover was compromised.",
        "Setup was simple enough for a visitor.",
        "I am still unsure why humans need this many buttons.",
        "The item has a strong \"do not ask\" energy."
      ]
    }
    : {
      detail: description ? `The ${description.toLowerCase()} detail felt consistent with the listing and the photos.` : `It arrived with the same sort of polish I expected from the listing.`,
      opener: {
        1: ["I checked the listing twice and still felt disappointed.", "This landed in the wrong part of my day.", "The first impression was rough."],
        2: ["It is usable, though the edges show.", "I kept hoping for a little more.", "The value is only partly there."],
        3: ["It holds together as expected.", "A fair result for an ordinary purchase.", "Nothing flashy, but it behaves well."],
        4: ["This makes a strong case for itself.", "A pleasant surprise for the price.", "It feels more capable than the listing suggested."],
        5: ["This is one of the better purchases I have made.", "I would happily place this order again.", "It feels like the good kind of marketplace luck."]
      },
      closing: {
        1: ["I would not repeat the purchase.", "It never quite came together.", "The quality missed the mark."],
        2: ["I can make it work, but I would not praise it.", "It stays just above the line.", "I wanted cleaner execution."],
        3: ["It is steady and serviceable.", "A normal outcome that does the job.", "I would call it acceptably ordinary."],
        4: ["I would point a friend at it.", "A dependable pick for daily use.", "It earns its place easily."],
        5: ["I would buy it again without hesitation.", "It feels like the sort of thing that ages well.", "A genuinely strong result."]
      },
      firstAddendum: `It is the sort of ${subject.toLowerCase()} I wanted on the first try.`,
      otherAddendum: [
        "The packaging stayed neat.",
        "It arrived in good shape.",
        "The finish matched the photos.",
        "Setup was straightforward.",
        "I laughed at how normal it was, which is probably a good sign.",
        "It has the sort of charm that sneaks up on you."
      ]
    };

  const opener = pick(random, tone.opener[rating]);
  const closing = pick(random, tone.closing[rating]);
  const addendum = firstEncounter ? tone.firstAddendum : pick(random, tone.otherAddendum);

  return `${opener} ${tone.detail} ${closing} ${addendum}`;
}

export function createReviews(id, title = "", description = "", { mode = "normal" } = {}) {
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
      title: createReviewTitle(random, title, description, rating, index, mode),
      body: createReviewText(random, title, description, rating, index, mode),
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
