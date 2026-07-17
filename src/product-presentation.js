function hash(value) {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

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

export function createReviewSummary(id) {
  const count = hash(`${id}:reviews`) % 251;
  return {
    rating: count === 0 ? null : 1 + (hash(`${id}:rating`) % 5),
    reviewCount: count
  };
}
