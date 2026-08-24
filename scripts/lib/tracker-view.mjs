import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { openQuestions, safeUrl, title } from "./tracker-text.mjs";
import { CLIENT_SCRIPT, STYLES } from "./tracker-view-assets.mjs";

const PRICE_FIELD = "property.pricing.price";

const FITS = {
  prioritize: { label: "Great fit", rank: 3 },
  visit: { label: "Worth a look", rank: 2 },
  monitor: { label: "Needs a closer look", rank: 1 },
  discard: { label: "Skip", rank: 0 }
};

const STATES = {
  watching: "still watching",
  shortlisted: "shortlisted",
  contacted: "contacted",
  visited: "visited",
  archived: "ruled out"
};

const AVAILABILITY = {
  unknown: "availability unknown",
  available: "available",
  reserved: "reserved",
  unavailable: "no longer available",
  removed: "removed by the seller"
};

// Plain-language names for the deterministic field paths, keyed by the last segment so a
// differently rooted profile still resolves. Anything unlisted falls back to the criterion label.
const FIELD_NAMES = {
  price: "Price",
  currency: "Currency",
  expenses: "Common expenses",
  operation: "Rent or sale",
  property_type: "Property type",
  city: "City",
  neighborhood: "Neighborhood",
  address: "Address",
  bedrooms: "Bedrooms",
  bathrooms: "Bathrooms",
  area_total_m2: "Size",
  area_covered_m2: "Covered size",
  parking_spaces: "Parking"
};

// Failed hard filters, keyed by the criterion's field path.
const FAILED_FILTERS = {
  "property.pricing.price": "Over your budget",
  "property.operation": "Not offered for rent",
  "property.property_type": "Not a flat or a house",
  "property.location.city": "Outside the city you picked",
  "property.location.neighborhood": "Outside the neighborhoods you picked"
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Titles and notes are third-party text. Neutralise anything that could close the script
// element or terminate the JS string context the JSON is parsed from.
export function escapeJson(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll(" ", "\\u2028")
    .replaceAll(" ", "\\u2029");
}

export function formatNumber(value) {
  return value === null || value === undefined ? "not listed" : value.toLocaleString("en-US");
}

export function formatMoney(amount, currency) {
  return amount === null || amount === undefined ? "not listed" : `${currency ?? "?"} ${amount.toLocaleString("en-US")}`;
}

export function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return String(value);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

export function fitLabel(recommendation) {
  return (FITS[recommendation] ?? { label: recommendation }).label;
}

export function fitRank(recommendation) {
  return (FITS[recommendation] ?? { rank: -1 }).rank;
}

export function stateLabel(state) {
  return STATES[state] ?? state;
}

export function availabilityLabel(availability) {
  return AVAILABILITY[availability] ?? availability;
}

function fieldName(field, label) {
  const segment = String(field ?? "").split(".").at(-1);
  return FIELD_NAMES[segment] ?? label ?? field;
}

/**
 * The price ceiling lives only inside evaluated criteria today. Read it straight from the
 * profile's hard filters and fail loudly rather than guessing a scale, and never parse the
 * human label — in real profiles it drifts away from the value.
 */
export function readCeiling(profile) {
  const filters = (profile?.hard_filters ?? []).filter((filter) => filter.field === PRICE_FIELD && filter.currency);
  if (filters.length !== 1) {
    throw new Error("Tracker view requires exactly one monthly price hard filter with a currency in the profile");
  }
  const [filter] = filters;
  if (typeof filter.value !== "number") {
    throw new Error("Tracker view requires a numeric value on the monthly price hard filter");
  }
  return { amount: filter.value, currency: filter.currency };
}

/**
 * Every red flag is produced by a template in evaluate.mjs, so the vocabulary is closed.
 * An unmatched string falls through verbatim rather than being dropped or paraphrased.
 */
export function describeFlag(text, fieldByLabel = new Map()) {
  const full = String(text);
  const stale = /^Listing may be stale \((\d+) days; basis: .+\)$/.exec(full);
  if (stale) {
    return {
      short: `Posted ${stale[1]} days ago`,
      full,
      advice: "Older than the freshness window you set, so it may already be taken. Worth a message before planning a visit."
    };
  }
  if (/^Freshness timestamp is in the future \(basis: .+\)$/.test(full)) {
    return { short: "Listing date looks wrong", full, advice: "The source reports a date that has not happened yet. Treat its age as unknown." };
  }
  if (/^Possible duplicate record .+ \(.+ confidence\)$/.test(full)) {
    return { short: "May be the same place as another listing", full, advice: "Two sources look like the same property. Check before treating them as separate options." };
  }
  if (full === "No source URL is available for verification") {
    return { short: "No link to the original", full, advice: "Nothing to open and re-check, so everything here rests on the saved copy." };
  }
  const failed = /^Failed hard filter: (.+)$/.exec(full);
  if (failed) {
    const field = fieldByLabel.get(failed[1]);
    return {
      short: FAILED_FILTERS[field] ?? failed[1],
      full,
      advice: "This one misses something you set as a must-have."
    };
  }
  if (/^Maximum possible weighted score .+ is below the .+ discard floor$/.test(full)) {
    return { short: "Matches too little of what you want", full, advice: "Even if every unknown turned out well, it would still fall short of what you asked for." };
  }
  return { short: full, full, advice: null };
}

/**
 * missing_data arrives as `${label}: ${reason}`, and the reason half leaks field paths.
 * Keep the label for the reader and the whole original for the tooltip.
 */
export function describeMissing(text) {
  const full = String(text);
  const split = full.indexOf(": ");
  if (split === -1) return { short: full, full, currency: null };
  const label = full.slice(0, split);
  const reason = full.slice(split + 2);

  const mismatch = /^currency is ([A-Z]{3}), not [A-Z]{3}; HomeOps does not convert currencies$/.exec(reason);
  if (mismatch) return { short: `Priced in ${mismatch[1]}`, full, currency: mismatch[1] };

  const noCurrency = /^(.+) is unknown; [A-Z]{3} comparison was not performed$/.exec(reason);
  if (noCurrency) return { short: "Currency not listed", full, currency: null };

  const unknown = /^(.+) is unknown$/.exec(reason);
  if (unknown) return { short: `${fieldName(unknown[1], label)} not listed`, full, currency: null };

  if (/ is inferred but this criterion does not allow inferred evidence$/.test(reason)) {
    return { short: "Some details unconfirmed", full, currency: null };
  }
  return { short: full, full, currency: null };
}

function humaniseEvent(event) {
  const when = formatDate(event.recorded_at);
  const payload = event.payload ?? {};
  if (event.type === "tracking_started") return { what: "Added to the tracker", when };
  if (event.type === "state_changed") return { what: `Moved to ${stateLabel(payload.to)}`, when };
  if (event.type === "availability_changed") return { what: `Marked ${availabilityLabel(payload.to)}`, when };
  if (event.type === "note_added") return { what: `Note: ${payload.text}`, when };
  if (event.type === "question_added") return { what: `Question raised: ${payload.text}`, when };
  if (event.type === "question_answered") return { what: `Question answered: ${payload.text}`, when };
  if (event.type === "visit_recorded") return { what: `Visit recorded for ${formatDate(payload.visited_at)}`, when };
  if (event.type === "decision_recorded") return { what: `Decision: ${payload.decision}`, when };
  return { what: event.type, when };
}

function byText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function nullLast(left, right, direction) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return (left - right) * direction;
}

/** Total order: fit bucket, then the hidden score, then price, then id. Never a partial sort. */
export function rankListings(items) {
  return items.toSorted((left, right) =>
    right.fitRank - left.fitRank
    || right.score - left.score
    || nullLast(left.price, right.price, 1)
    || byText(left.id, right.id));
}

function niceStep(rough) {
  if (!(rough > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  for (const factor of [1, 2, 2.5, 5, 10]) {
    if (rough <= factor * magnitude) return Math.max(1, Math.round(factor * magnitude));
  }
  return Math.max(1, Math.round(10 * magnitude));
}

/**
 * One scale shared by every row, rounded outward from the real range. A per-row scale would
 * make neighborhoods look comparable when they are not. The ceiling is forced inside the
 * domain so its line always lands on the canvas.
 */
export function chartScale(values, ceiling) {
  const points = [...values, ceiling].filter((value) => typeof value === "number");
  if (points.length === 0) return { min: 0, max: 1, step: 1, ticks: [0, 1] };
  const low = Math.min(...points);
  const high = Math.max(...points);
  const span = high - low || Math.max(high, 1);
  const step = niceStep(span / 4);
  // Round the bounds on a finer grain than the tick step, so a tight range does not
  // get padded out to a fifth of the axis at each end.
  const grain = niceStep(span / 8);
  const min = Math.floor(low / grain) * grain;
  const max = Math.ceil(high / grain) * grain;
  const width = max - min || step;
  return { min, max: min + width, step, ticks: [min, min + width / 2, min + width] };
}

function position(value, scale) {
  const span = scale.max - scale.min || 1;
  return Math.min(Math.max(((value - scale.min) / span) * 100, 0), 100);
}

function pct(value) {
  return `${value.toFixed(2)}%`;
}

export function buildTrackerView({
  now, trackerPath, inventoryPath, records, listings, evaluations, evaluationReports = new Map(), profile
}) {
  const ceiling = readCeiling(profile);
  const listingById = new Map(listings.map((listing) => [listing.id, listing]));
  const evaluationById = new Map(evaluations.map((evaluation) => [evaluation.listing.id, evaluation]));
  const fieldByLabel = new Map([
    ...(profile.hard_filters ?? []).map((filter) => [filter.label, filter.field]),
    ...(profile.weighted_criteria ?? []).map((criterion) => [criterion.label, criterion.field])
  ]);

  const items = records.map((record) => {
    const listing = listingById.get(record.listing_id);
    const evaluation = evaluationById.get(record.listing_id);
    const pricing = listing.property.pricing;
    const features = listing.property.features;

    const flags = evaluation.red_flags.map((flag) => describeFlag(flag, fieldByLabel));
    const unknown = evaluation.missing_data.map(describeMissing);
    if (listing.duplicate.group_id) {
      flags.push({
        short: "May be the same place as another listing",
        full: `Duplicate candidate: ${listing.duplicate.group_id} (${listing.duplicate.confidence})`,
        advice: "Two sources look like the same property. Check before treating them as separate options."
      });
    }
    const foreignCurrency = pricing.currency !== null && pricing.currency !== ceiling.currency;
    if (foreignCurrency && !unknown.some((entry) => entry.currency)) {
      flags.push({ short: `Priced in ${pricing.currency}`, full: `Priced in ${pricing.currency}; HomeOps does not convert currencies`, advice: null });
    }

    const criteria = [
      ...evaluation.hard_filters.map((filter) => ({ label: filter.label, outcome: filter.outcome })),
      ...evaluation.score.criteria.map((criterion) => ({ label: criterion.label, outcome: criterion.outcome }))
    ];

    // Templated questions from the deterministic layer, plus the user's own unanswered ones.
    const questions = [...evaluation.questions, ...openQuestions(record).map(([, text]) => text)];

    return {
      id: listing.id,
      title: title(listing),
      url: safeUrl(listing.source.url),
      source: listing.source.provider,
      price: pricing.price,
      currency: pricing.currency,
      expenses: pricing.expenses,
      expensesCurrency: pricing.expenses_currency,
      bedrooms: features.bedrooms,
      bathrooms: features.bathrooms,
      area: features.area_total_m2,
      parking: features.parking_spaces,
      neighborhood: listing.property.location.neighborhood,
      address: listing.property.location.address,
      fit: fitLabel(evaluation.recommendation),
      fitRank: fitRank(evaluation.recommendation),
      score: evaluation.score.percentage,
      foreignCurrency,
      flags,
      matched: evaluation.matches,
      tradeOffs: evaluation.trade_offs,
      unknown,
      questions,
      criteria,
      state: record.state,
      stateLabel: stateLabel(record.state),
      availability: record.availability,
      updatedAt: record.updated_at,
      history: record.events.map(humaniseEvent),
      reportHref: evaluationReports.get(listing.id) ?? null
    };
  });

  const active = items.filter((item) => item.state !== "archived");
  const archived = rankListings(items.filter((item) => item.state === "archived"));
  const local = rankListings(active.filter((item) => !item.foreignCurrency));
  const foreign = active
    .filter((item) => item.foreignCurrency)
    .toSorted((left, right) => nullLast(left.price, right.price, 1) || byText(left.id, right.id));

  const buckets = [3, 2, 1, 0]
    .map((rank) => ({
      rank,
      label: Object.values(FITS).find((fit) => fit.rank === rank).label,
      items: local.filter((item) => item.fitRank === rank)
    }))
    .filter((bucket) => bucket.items.length > 0);

  const neighborhoods = [...new Set(active.map((item) => item.neighborhood ?? "Neighborhood not listed"))].sort(byText);

  return {
    meta: {
      generatedAt: now,
      trackerPath,
      inventoryPath,
      profileName: profile.name ?? null,
      currency: ceiling.currency,
      ceiling,
      counts: {
        tracked: items.length,
        active: active.length,
        archived: archived.length,
        foreignCurrency: foreign.length
      }
    },
    neighborhoods,
    buckets,
    foreign,
    archived,
    listings: items,
    chart: buildChart(local, ceiling)
  };
}

function buildChart(items, ceiling) {
  const priced = items.filter((item) => item.price !== null);
  const scale = chartScale(priced.map((item) => item.price), ceiling.amount);
  const grouped = new Map();
  for (const item of priced) {
    const key = item.neighborhood ?? "Neighborhood not listed";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }
  const rows = [...grouped.entries()]
    .map(([neighborhood, group]) => {
      const prices = group.map((item) => item.price);
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      return {
        neighborhood,
        count: group.length,
        min,
        max,
        dots: group
          .toSorted((left, right) => left.price - right.price || byText(left.id, right.id))
          .map((item) => ({
            id: item.id,
            price: item.price,
            great: item.fitRank === 3,
            tip: `${item.title} — ${formatMoney(item.price, item.currency)} — ${item.fit}`
          }))
      };
    })
    .toSorted((left, right) => left.min - right.min || byText(left.neighborhood, right.neighborhood));

  const overCeiling = priced.filter((item) => item.price > ceiling.amount).length;
  const great = priced.filter((item) => item.fitRank === 3);
  const cheapest = rows.slice(0, 3);

  const readouts = [];
  readouts.push(overCeiling === 0
    ? {
      head: "Yes",
      body: `Every one of the ${priced.length} places priced in ${ceiling.currency} sits at or below your ceiling of ${formatMoney(ceiling.amount, ceiling.currency)}. Budget is not what is holding this back.`
    }
    : overCeiling * 2 < priced.length
      ? {
        head: "Yes, mostly",
        body: `Only ${overCeiling} of ${priced.length} places ${overCeiling === 1 ? "sits" : "sit"} above your ceiling of ${formatMoney(ceiling.amount, ceiling.currency)}. Budget is not the main constraint.`
      }
      : {
        head: "Not comfortably",
        body: `${overCeiling} of ${priced.length} places ${overCeiling === 1 ? "sits" : "sit"} above your ceiling of ${formatMoney(ceiling.amount, ceiling.currency)}. Most of what is being tracked is out of reach at this budget.`
      });

  readouts.push(cheapest.length === 0
    ? { head: "No neighborhoods yet", body: "Nothing priced in your currency is being tracked, so there is no range to compare." }
    : {
      head: cheapest.map((row) => row.neighborhood).join(", "),
      body: `These start lowest, from ${formatMoney(cheapest[0].min, ceiling.currency)}. They leave the most room if you want more space for the same money.`
    });

  readouts.push(great.length === 0
    ? { head: "No great fits yet", body: "Nothing currently clears every must-have, so there is no cluster to aim at." }
    : {
      head: great.length === 1 ? "1 great fit" : `${great.length} great fits`,
      body: `They sit between ${formatMoney(Math.min(...great.map((item) => item.price)), ceiling.currency)} and ${formatMoney(Math.max(...great.map((item) => item.price)), ceiling.currency)}, so a realistic target is that band rather than the bottom of the range.`
    });

  return { scale, rows, readouts, ceiling, plotted: priced.length };
}

function factsLine(item) {
  return [
    item.bedrooms === null ? "bedrooms not listed" : item.bedrooms === 0 ? "studio" : `${item.bedrooms} bed`,
    item.bathrooms === null ? "bathrooms not listed" : `${item.bathrooms} bath`,
    item.area === null ? "size not listed" : `${formatNumber(item.area)} m²`,
    item.parking === null ? "parking not listed" : item.parking > 0 ? "parking" : "no parking"
  ].join(" · ");
}

function expensesLine(item) {
  if (item.expenses === null) return "expenses not listed";
  return `+ ${formatMoney(item.expenses, item.expensesCurrency ?? item.currency)} expenses`;
}

function flagBadge(item) {
  if (item.flags.length === 0) {
    return '<span class="badge" title="No warnings">No warnings</span>';
  }
  const tooltip = item.flags.map((flag) => flag.full).join(" · ");
  const label = item.flags.length === 1 ? item.flags[0].short : `${item.flags.length} things to check`;
  return `<span class="badge has-warning" title="${escapeHtml(tooltip)}">${escapeHtml(label)}</span>`;
}

function outLink(item, text) {
  if (!item.url) return "";
  return `<a class="out" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)} ↗</a>`;
}

function card(item) {
  return `<article class="card" data-id="${escapeHtml(item.id)}" data-nb="${escapeHtml(item.neighborhood ?? "Neighborhood not listed")}" data-state="${escapeHtml(item.state)}" data-fit-rank="${item.fitRank}" data-score="${item.score}" data-price="${item.price ?? ""}" data-area="${item.area ?? ""}" data-updated="${escapeHtml(item.updatedAt)}">
  <div class="card-main">
    <a class="card-title" href="#place/${encodeURIComponent(item.id)}">${escapeHtml(item.title)}</a>
    <div class="card-where">${escapeHtml(item.neighborhood ?? "Neighborhood not listed")}</div>
    <div class="card-facts">${escapeHtml(factsLine(item))}</div>
    <div class="card-meta">
      <span class="tag">${escapeHtml(item.stateLabel)}</span>
      ${flagBadge(item)}
      ${outLink(item, item.source)}
    </div>
  </div>
  <div class="card-side">
    <div class="price">${escapeHtml(formatMoney(item.price, item.currency))}</div>
    <div class="expenses">${escapeHtml(expensesLine(item))}</div>
    <span class="fit" data-fit-rank="${item.fitRank}">${escapeHtml(item.fit)}</span>
    <a class="detail-link" href="#place/${encodeURIComponent(item.id)}">see the details →</a>
  </div>
</article>`;
}

function bucketBlock({ label, note, count, items, foreign = false }) {
  return `<section class="bucket"${foreign ? " data-foreign" : ""}>
  <div class="bucket-head">
    <h2>${escapeHtml(label)}</h2>
    <span class="count">${escapeHtml(count)}</span>
  </div>
  ${note ? `<p class="bucket-note">${escapeHtml(note)}</p>` : ""}
  <div class="bucket-body">
${items.map(card).join("\n")}
  </div>
</section>`;
}

function railChips(group, options) {
  return `<div class="chips">${options.map((option) =>
    `<button type="button" class="chip" data-group="${group}" data-value="${escapeHtml(option.value)}" aria-pressed="${option.value === options[0].value ? "true" : "false"}">${escapeHtml(option.label)}</button>`
  ).join("")}</div>`;
}

function listScreen(view) {
  const rail = `<aside class="rail">
  <section>
    <h3>How it's going</h3>
    <ul class="tally">
      ${[3, 2, 1, 0].map((rank) => {
        const label = Object.values(FITS).find((fit) => fit.rank === rank).label;
        const count = view.buckets.find((bucket) => bucket.rank === rank)?.items.length ?? 0;
        return `<li><span>${escapeHtml(label)}</span><b data-tally="${rank}">${count}</b></li>`;
      }).join("\n      ")}
    </ul>
  </section>
  <section>
    <h3>Sort by</h3>
    ${railChips("sort", [
      { value: "fit", label: "Best fit" },
      { value: "price", label: "Price: low first" },
      { value: "space", label: "Most space" },
      { value: "updated", label: "Recently updated" }
    ])}
  </section>
  <section>
    <h3>Status</h3>
    ${railChips("status", [
      { value: "all", label: "Everything active" },
      { value: "watching", label: "Only watching" },
      { value: "great", label: "Great fits only" }
    ])}
  </section>
  <section>
    <h3>Neighborhood</h3>
    ${railChips("nb", [{ value: "all", label: "All" }, ...view.neighborhoods.map((name) => ({ value: name, label: name }))])}
  </section>
</aside>`;

  const bucketsHtml = view.buckets.map((bucket) => bucketBlock({
    label: bucket.label,
    count: bucket.items.length === 1 ? "1 place" : `${bucket.items.length} places`,
    items: bucket.items
  })).join("\n");

  const foreignHtml = view.foreign.length === 0 ? "" : bucketBlock({
    label: `Priced in another currency`,
    count: view.foreign.length === 1 ? "1 place" : `${view.foreign.length} places`,
    note: `Your budget is set in ${view.meta.currency}. HomeOps never converts currencies, so these are kept in their own group, unranked, and never mixed in with the rest.`,
    items: view.foreign,
    foreign: true
  });

  const archivedHtml = view.archived.length === 0 ? "" : `<section class="archived">
  <div class="bucket-head archived-head">
    <h2>Ruled out</h2>
    <span class="count">${view.archived.length === 1 ? "1 place" : `${view.archived.length} places`}</span>
  </div>
  ${view.archived.map((item) => `<div class="archived-row">
    <a href="#place/${encodeURIComponent(item.id)}">${escapeHtml(item.title)}</a>
    <span class="nb">${escapeHtml(item.neighborhood ?? "Neighborhood not listed")}</span>
    <span class="p">${escapeHtml(formatMoney(item.price, item.currency))}</span>
  </div>`).join("\n  ")}
</section>`;

  const empty = view.buckets.length === 0 && view.foreign.length === 0
    ? '<p class="empty" id="list-empty">No places are being tracked yet.</p>'
    : '<p class="empty" id="list-empty" hidden>Nothing matches these filters.</p>';

  return `<section class="screen is-active" id="screen-list">
  <div class="wrap">
    <div class="cols">
      ${rail}
      <div class="content">
${bucketsHtml}
${foreignHtml}
${empty}
${archivedHtml}
      </div>
    </div>
  </div>
</section>`;
}

function ceilingLine(item, ceiling) {
  if (item.price === null) return "Price not listed, so it cannot be compared to your ceiling.";
  if (item.foreignCurrency) {
    return `Priced in ${item.currency}, not ${ceiling.currency}. HomeOps does not convert currencies, so this is not measured against your ceiling.`;
  }
  const difference = ceiling.amount - item.price;
  const ceilingText = formatMoney(ceiling.amount, ceiling.currency);
  if (difference >= 0) return `About ${formatNumber(difference)} ${ceiling.currency} under your ceiling of ${ceilingText}.`;
  return `About ${formatNumber(-difference)} ${ceiling.currency} over your ceiling of ${ceilingText}.`;
}

function detail(item, ceiling) {
  const outcomeText = { pass: "yes", fail: "no", unknown: "not mentioned" };
  return `<article class="detail" data-id="${escapeHtml(item.id)}" hidden>
  <a class="back" href="#list">← back to all places</a>
  <div class="detail-head">
    <div>
      <h2>${escapeHtml(item.title)}</h2>
      <div class="card-where">${escapeHtml(item.neighborhood ?? "Neighborhood not listed")} · ${escapeHtml(factsLine(item))}</div>
      <div class="card-meta">
        <span class="fit" data-fit-rank="${item.fitRank}">${escapeHtml(item.fit)}</span>
        <span class="tag">${escapeHtml(item.stateLabel)}</span>
        ${item.url ? outLink(item, `open the original on ${item.source}`) : '<span class="tag">no link to the original</span>'}
      </div>
    </div>
    <div class="card-side">
      <div class="price">${escapeHtml(formatMoney(item.price, item.currency))}</div>
      <div class="expenses">${escapeHtml(expensesLine(item))}</div>
    </div>
  </div>
  <div class="detail-cols">
    <div class="detail-main">
      <div class="block">
        <h3>Why it looks good</h3>
        ${item.matched.length === 0
          ? '<p class="empty">Nothing on your list is confirmed for this one.</p>'
          : `<ul>${item.matched.map((label) => `<li><span class="mark">✓</span>${escapeHtml(label)}</li>`).join("")}</ul>`}
      </div>
      <div class="block">
        <h3>Worth checking</h3>
        ${item.flags.length === 0
          ? '<p class="empty">Nothing flagged.</p>'
          : item.flags.map((flag) => `<div class="check" title="${escapeHtml(flag.full)}">
          <b>${escapeHtml(flag.short)}</b>
          ${flag.advice ? `<span>${escapeHtml(flag.advice)}</span>` : ""}
        </div>`).join("\n        ")}
      </div>
      <div class="block">
        <h3>Things the listing never said</h3>
        ${item.unknown.length === 0
          ? '<p class="empty">Everything you asked about was stated.</p>'
          : `<ul>${item.unknown.map((entry) => `<li title="${escapeHtml(entry.full)}"><span class="mark">?</span>${escapeHtml(entry.short)}</li>`).join("")}</ul>`}
      </div>
      <div class="block">
        <h3>Ask the owner</h3>
        ${item.questions.length === 0
          ? '<p class="empty">Nothing outstanding to ask.</p>'
          : item.questions.map((question) => `<p class="quote">${escapeHtml(question)}</p>`).join("\n        ")}
        <p class="disclaimer">Suggestions only — nobody has been contacted.</p>
      </div>
    </div>
    <div class="detail-side">
      <div class="block">
        <h3>Compared to what you want</h3>
        ${item.criteria.map((criterion) => `<div class="crit"><span>${escapeHtml(criterion.label)}</span><span class="o" data-outcome="${escapeHtml(criterion.outcome)}">${escapeHtml(outcomeText[criterion.outcome] ?? criterion.outcome)}</span></div>`).join("\n        ")}
      </div>
      <div class="block">
        <h3>Against your ceiling</h3>
        <p class="card-facts">${escapeHtml(ceilingLine(item, ceiling))}</p>
      </div>
      <div class="block">
        <h3>What's happened so far</h3>
        ${item.history.map((entry) => `<div class="hist">${escapeHtml(entry.what)}<div class="when">${escapeHtml(entry.when)}</div></div>`).join("\n        ")}
      </div>
      <div class="block">
        <h3>Sources</h3>
        <p class="card-facts">${item.url ? outLink(item, `original listing on ${item.source}`) : `Saved from ${escapeHtml(item.source)}; no link available.`}</p>
        ${item.reportHref ? `<p class="card-facts"><a class="out" href="${escapeHtml(item.reportHref)}">full evaluation report</a></p>` : ""}
      </div>
      <p class="readonly-note">This is a reading copy. Nothing on this page can change the tracker.</p>
    </div>
  </div>
</article>`;
}

function detailScreen(view) {
  return `<section class="screen" id="screen-detail">
  <div class="wrap">
${view.listings.map((item) => detail(item, view.meta.ceiling)).join("\n")}
  </div>
</section>`;
}

function budgetScreen(view) {
  const { chart, meta } = view;
  const { scale } = chart;
  const rows = chart.rows.map((row) => {
    const bar = row.min === row.max
      ? ""
      : `<div class="chart-bar" style="left:${pct(position(row.min, scale))};width:${pct(position(row.max, scale) - position(row.min, scale))}"></div>`;
    const dots = row.dots.map((dot) =>
      `<div class="dot ${dot.great ? "great" : "other"}" style="left:${pct(position(dot.price, scale))}" title="${escapeHtml(dot.tip)}"></div>`
    ).join("");
    return `<div class="chart-row">
      <div class="chart-label"><b>${escapeHtml(row.neighborhood)}</b><span>${row.count === 1 ? "1 place" : `${row.count} places`}</span></div>
      <div class="chart-plot">${bar}${dots}</div>
      <div class="chart-range">${escapeHtml(row.min === row.max ? formatNumber(row.min) : `${formatNumber(row.min)} – ${formatNumber(row.max)}`)}</div>
    </div>`;
  }).join("\n    ");

  const ceilingOverlay = `<div class="ceiling" style="left:calc(150px + (100% - 280px) * ${(position(meta.ceiling.amount, scale) / 100).toFixed(4)})"><b>your ceiling, ${escapeHtml(formatMoney(meta.ceiling.amount, meta.ceiling.currency))}</b></div>`;

  return `<section class="screen" id="screen-budget">
  <div class="wrap">
    <h2>Is the budget realistic?</h2>
    <p class="card-where">${chart.plotted} ${chart.plotted === 1 ? "place" : "places"} priced in ${escapeHtml(meta.currency)}, across ${chart.rows.length} ${chart.rows.length === 1 ? "neighborhood" : "neighborhoods"}.</p>
    <div class="legend">
      <span><span class="key key-bar"></span>what this area costs</span>
      <span><span class="key key-dot filled"></span>a great fit</span>
      <span><span class="key key-dot"></span>everything else</span>
      <span><span class="key key-line"></span>your ceiling</span>
    </div>
    <div class="chart-scroll"><div class="chart-inner">
    ${chart.rows.length === 0 ? '<p class="empty">Nothing priced in your currency is being tracked yet.</p>' : `<div class="chart">
    ${rows}
    ${ceilingOverlay}
    </div>
    <div class="axis"><div class="spacer"></div><div class="ticks">${scale.ticks.map((tick) => `<span>${escapeHtml(formatNumber(Math.round(tick)))}</span>`).join("")}</div><div class="tail"></div></div>`}
    </div></div>
    <div class="readouts">
      ${chart.readouts.map((readout) => `<div class="readout"><b>${escapeHtml(readout.head)}</b><span>${escapeHtml(readout.body)}</span></div>`).join("\n      ")}
    </div>
    ${meta.counts.foreignCurrency === 0 ? "" : `<p class="excluded">${meta.counts.foreignCurrency} ${meta.counts.foreignCurrency === 1 ? "place is" : "places are"} priced in another currency and ${meta.counts.foreignCurrency === 1 ? "is" : "are"} kept out of this chart. HomeOps never converts currencies, so mixing them in would invent a number nobody quoted.</p>`}
  </div>
</section>`;
}

export function renderTrackerView(view) {
  const counts = view.meta.counts;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>HomeOps tracker — reading copy</title>
<style>${STYLES}</style>
</head>
<body>
<header class="page-head">
  <div class="wrap">
    <h1>Places we're looking at</h1>
    <div class="sub">${counts.active} still in play · ${counts.archived} ruled out · ${counts.tracked} tracked in total</div>
    <div class="stamp">Snapshot generated ${escapeHtml(formatDate(view.meta.generatedAt))} (${escapeHtml(view.meta.generatedAt)}). Freshness is recalculated when this file is generated, so it ages silently — regenerate before trusting it.</div>
    <div class="privacy">This file contains private search data. It is a derived, read-only copy: nothing on any page can change the tracker. Check before forwarding it.</div>
  </div>
</header>
<nav class="wrap">
  <ul class="tabs">
    <li><a href="#list" data-route="list" class="is-current">The list</a></li>
    <li><a href="#budget" data-route="budget">Is the budget realistic?</a></li>
  </ul>
</nav>
<main>
${listScreen(view)}
${detailScreen(view)}
${budgetScreen(view)}
</main>
<script type="application/json" id="tracker-view">${escapeJson(view)}</script>
<script>${CLIENT_SCRIPT}</script>
</body>
</html>
`;
}

export async function writeTrackerView(path, html) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, html, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return path;
}
