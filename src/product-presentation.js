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

function shortenSubject(value, maxWords = 3, maxChars = 28) {
  const words = value.split(/\s+/).filter(Boolean).slice(0, maxWords);
  let result = words.join(" ");
  while (result.length > maxChars && words.length > 1) {
    words.pop();
    result = words.join(" ");
  }
  return result;
}

function escapeXml(value) {
  return value.replace(/[<>&"']/g, (character) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&apos;"
  })[character]);
}

function illustration(title, description, variant) {
  const subject = `${title} ${description || ""}`.toLowerCase();
  const value = hash(`${title}:${description || ""}:${variant || ""}`);
  const accent = `hsl(${value % 360} 68% 52%)`;
  const accentLight = `hsl(${(value + 42) % 360} 72% 78%)`;
  const accentDark = `hsl(${(value + 18) % 360} 58% 34%)`;
  const accentSoft = `hsl(${(value + 84) % 360} 54% 90%)`;
  const neutral = `hsl(${(value + 132) % 360} 14% 32%)`;
  const rotation = (value % 25) - 12;
  const badgeX = 44 + (value % 30);
  const badgeY = 44 + ((value >>> 8) % 30);
  const layout = value % 8;
  const variantMark = `<g transform="rotate(${rotation} 200 170)"><circle cx="${badgeX}" cy="${badgeY}" r="24" fill="${accentLight}"/><path d="M${badgeX - 11} ${badgeY}h22M${badgeX} ${badgeY - 11}v22" stroke="${accent}" stroke-width="7" stroke-linecap="round"/></g>`;
  if (/\b(phone|smartphone|iphone|mobile|android)\b/.test(subject)) {
    return `<rect x="116" y="30" width="168" height="260" rx="24" fill="${neutral}"/><rect x="128" y="52" width="144" height="200" rx="12" fill="${accentLight}"/><rect x="142" y="66" width="116" height="170" rx="8" fill="${accentSoft}" opacity="0.75"/><circle cx="200" cy="270" r="9" fill="#F4F7FA"/>${variantMark}`;
  }
  if (/headphone|headset|earbud/.test(subject)) {
    return `<path d="M100 205V155a100 100 0 0 1 200 0v50" fill="none" stroke="${neutral}" stroke-width="26" stroke-linecap="round"/><rect x="75" y="190" width="56" height="78" rx="20" fill="${accent}"/><rect x="269" y="190" width="56" height="78" rx="20" fill="${accentDark}"/><rect x="87" y="202" width="32" height="18" rx="9" fill="${accentSoft}"/><rect x="281" y="202" width="32" height="18" rx="9" fill="${accentSoft}"/>${variantMark}`;
  }
  switch (layout) {
    case 0:
      return `<rect x="86" y="90" width="228" height="172" rx="18" fill="${accent}"/><rect x="86" y="90" width="228" height="38" rx="18" fill="${accentDark}"/><path d="M86 131h228M200 90v172" stroke="#FFF7E8" stroke-width="12"/><circle cx="200" cy="176" r="26" fill="${accentLight}"/><path d="M164 90l36-32 36 32" fill="${accentSoft}" opacity="0.9"/>${variantMark}`;
    case 1:
      return `<rect x="92" y="70" width="216" height="188" rx="24" fill="${accentDark}"/><rect x="112" y="88" width="176" height="112" rx="14" fill="${accentLight}"/><rect x="128" y="218" width="144" height="18" rx="9" fill="${accentSoft}"/><circle cx="200" cy="144" r="24" fill="${accent}"/><path d="M136 144h128" stroke="#FFF7E8" stroke-width="10" stroke-linecap="round"/>${variantMark}`;
    case 2:
      return `<path d="M120 86h160l24 40v120a18 18 0 0 1-18 18H114a18 18 0 0 1-18-18V126l24-40z" fill="${accent}"/><path d="M154 86h92l12 30H142z" fill="${accentDark}"/><circle cx="200" cy="174" r="32" fill="${accentLight}"/><rect x="166" y="212" width="68" height="16" rx="8" fill="${accentSoft}"/>${variantMark}`;
    case 3:
      return `<ellipse cx="200" cy="168" rx="90" ry="116" fill="${accent}"/><path d="M132 98c22 16 46 24 68 24s46-8 68-24" fill="none" stroke="${accentDark}" stroke-width="16" stroke-linecap="round"/><rect x="154" y="208" width="92" height="30" rx="15" fill="${accentLight}"/><circle cx="200" cy="164" r="34" fill="${accentSoft}"/>${variantMark}`;
    case 4:
      return `<rect x="98" y="98" width="204" height="124" rx="20" fill="${accentDark}"/><rect x="110" y="78" width="184" height="20" rx="10" fill="${accentLight}"/><rect x="110" y="228" width="184" height="22" rx="11" fill="${accent}"/><path d="M118 126h164M118 154h164M118 182h164" stroke="${accentSoft}" stroke-width="10" stroke-linecap="round"/>${variantMark}`;
    case 5:
      return `<rect x="126" y="50" width="148" height="220" rx="74" fill="${accent}"/><rect x="145" y="70" width="110" height="180" rx="55" fill="${accentDark}"/><path d="M162 112h76M162 148h76M162 184h76" stroke="${accentSoft}" stroke-width="10" stroke-linecap="round"/><circle cx="200" cy="270" r="12" fill="${accentLight}"/>${variantMark}`;
    case 6:
      return `<path d="M90 110c0-18 14-32 32-32h156c18 0 32 14 32 32v100c0 18-14 32-32 32H122c-18 0-32-14-32-32z" fill="${accentDark}"/><path d="M118 96h164l18 34H100z" fill="${accent}"/><circle cx="148" cy="164" r="24" fill="${accentLight}"/><circle cx="212" cy="164" r="24" fill="${accentSoft}"/><circle cx="274" cy="164" r="18" fill="${neutral}"/>${variantMark}`;
    default:
      return `<ellipse cx="200" cy="170" rx="116" ry="86" fill="${accent}"/><ellipse cx="200" cy="170" rx="82" ry="54" fill="${accentDark}"/><path d="M112 170h176" stroke="${accentSoft}" stroke-width="14" stroke-linecap="round"/><circle cx="200" cy="170" r="24" fill="${accentLight}"/><circle cx="146" cy="126" r="16" fill="${neutral}"/><circle cx="254" cy="214" r="16" fill="${neutral}"/>${variantMark}`;
  }
}

export function createProductImage(title, description, variant = "") {
  const label = escapeXml(title.slice(0, 48));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 340" role="img" aria-label="${label}"><rect width="400" height="340" fill="#FFF7E8"/>${illustration(title, description, variant)}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function createReviewTitle(random, title, description, rating, index, mode) {
  const subject = (title || description || "this item").toLowerCase();
  const subjectTag = shortenSubject(subject);
  const ratingLabels = mode === "alien"
    ? {
      1: ["First Contact", "Earth Warning", "Misfire", "Do Not Recommend", "Unsettling"],
      2: ["Borderline", "Barely Functional", "Mildly Strange", "Almost There", "Low Confidence"],
      3: ["Reasonable", "Average Orbit", "Serviceable", "Acceptable", "Middle Ground"],
      4: ["Strong Signal", "Good Cover", "Helpful Artifact", "Worth Sharing", "Solid Choice"],
      5: ["Triumph", "High Fidelity", "Mothership Approved", "Excellent Disguise", "Top Shelf"]
    }
    : {
      1: ["Rough Start", "Not Great", "Bit of a Miss", "Low Confidence", "Needs Work"],
      2: ["Mostly Fine", "Could Improve", "Near the Line", "A Little Clunky", "Mixed Feelings"],
      3: ["Pretty Solid", "Acceptably Ordinary", "Does the Job", "No Complaints", "Right in the Middle"],
      4: ["Better Than Expected", "Strong Value", "Pleasant Surprise", "Would Buy Again", "Very Good"],
      5: ["Excellent Find", "Worth the Hype", "Top Shelf", "Instant Favorite", "Genuinely Great"]
    };
  const suffixes = mode === "alien"
    ? {
      1: ["for Earth Use", "on First Sight", "from a Human Shelf", "in a Strange Way", "from the Surface"],
      2: ["with Some Doubt", "for Limited Use", "from a Nearby Orbit", "after Brief Study", "with Minor Concern"],
      3: ["for Routine Use", "as Expected", "in Human Terms", "with Cautious Approval", "without Incident"],
      4: ["for Daily Cover", "with Good Results", "for Visitor Life", "after Careful Testing", "with Strong Approval"],
      5: ["for the Mothership", "with Great Confidence", "for Full Assimilation", "with Excellent Results", "without Reservation"]
    }
    : {
      1: ["on First Try", "for the Price", "without Much Drama", "after a Rough Start", "with Low Expectations"],
      2: ["for Everyday Use", "with a Few Rough Edges", "after Some Doubt", "for Light Duty", "with Mixed Results"],
      3: ["for Normal Life", "without Complaints", "as Expected", "for the Basics", "in Daily Use"],
      4: ["for Regular Use", "with Good Value", "without Regret", "for a Solid Buy", "with Strong Results"],
      5: ["without Hesitation", "for the Win", "as a Favorite", "for Long-Term Use", "with High Confidence"]
    };

  const prefix = index === 0
    ? (mode === "alien" ? "First Encounter" : "First Impressions")
    : pick(random, mode === "alien"
      ? ["Unexpected Report", "Field Note", "Observed Behavior", "Transmission Log", "Quick Sighting"]
      : ["Quick Note", "Short Take", "Fresh Impressions", "Field Report", "Brief Verdict"]);

  const chosen = pick(random, ratingLabels[rating]);
  const suffix = pick(random, suffixes[rating]);
  return `${prefix}: ${chosen}${subjectTag ? ` on ${subjectTag}` : ""} ${suffix}`;
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
