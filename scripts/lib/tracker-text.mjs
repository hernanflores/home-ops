export function safe(value) {
  return String(value ?? "unknown").replace(/[\r\n]+/g, " ").replace(/([\\|\[\]`*_<>])/g, "\\$1");
}

export function safeUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.href.replace(/[<>]/g, "");
  } catch {
    return null;
  }
}

export function title(listing) {
  return listing.property.title ?? ([listing.property.property_type, listing.property.location.neighborhood].filter(Boolean).join(" in ") || listing.id);
}

export function money(pricing) {
  return pricing.price === null ? "unknown" : `${pricing.currency ?? "?"} ${pricing.price.toLocaleString("en-US")}`;
}

export function openQuestions(record) {
  const questions = new Map();
  for (const event of record.events) {
    if (event.type === "question_added") questions.set(event.id, event.payload.text);
    if (event.type === "question_answered") questions.delete(event.payload.question_id);
  }
  return [...questions.entries()];
}
