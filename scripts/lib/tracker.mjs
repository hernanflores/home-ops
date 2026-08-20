import { createHash } from "node:crypto";

export const TRACKER_STATES = ["watching", "shortlisted", "contacted", "visited", "archived"];
export const AVAILABILITY_STATES = ["unknown", "available", "reserved", "unavailable", "removed"];

const TRANSITIONS = {
  watching: new Set(["shortlisted", "contacted", "archived"]),
  shortlisted: new Set(["contacted", "archived"]),
  contacted: new Set(["visited", "archived"]),
  visited: new Set(["archived"]),
  archived: new Set()
};

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function trackerEventId(listingId, type, recordedAt, payload) {
  return `evt_${createHash("sha256").update(`${listingId}\0${type}\0${recordedAt}\0${canonical(payload)}`).digest("hex").slice(0, 16)}`;
}

function event(listingId, type, recordedAt, payload) {
  return { id: trackerEventId(listingId, type, recordedAt, payload), type, recorded_at: recordedAt, payload };
}

export function replayTrackerRecord(record) {
  if (record.events[0]?.type !== "tracking_started") throw new Error(`${record.listing_id}: first event must be tracking_started`);
  let state = "watching";
  let availability = "unknown";
  let previousTime = null;
  const eventIds = new Set();
  const questions = new Map();

  for (const current of record.events) {
    if (eventIds.has(current.id)) throw new Error(`${record.listing_id}: duplicate event id ${current.id}`);
    eventIds.add(current.id);
    if (trackerEventId(record.listing_id, current.type, current.recorded_at, current.payload) !== current.id) {
      throw new Error(`${record.listing_id}: event id does not match event content: ${current.id}`);
    }
    const currentTime = new Date(current.recorded_at).valueOf();
    if (previousTime !== null && currentTime < previousTime) throw new Error(`${record.listing_id}: events are not chronological`);
    previousTime = currentTime;

    if (current.type === "tracking_started") {
      if (current !== record.events[0]) throw new Error(`${record.listing_id}: tracking_started may appear only once`);
    } else if (current.type === "state_changed") {
      if (current.payload.from !== state || !TRANSITIONS[state].has(current.payload.to)) {
        throw new Error(`${record.listing_id}: invalid state transition ${current.payload.from} -> ${current.payload.to}`);
      }
      state = current.payload.to;
    } else if (current.type === "availability_changed") {
      if (current.payload.from !== availability || current.payload.to === availability) {
        throw new Error(`${record.listing_id}: invalid availability transition ${current.payload.from} -> ${current.payload.to}`);
      }
      availability = current.payload.to;
    } else if (current.type === "question_added") {
      questions.set(current.id, false);
    } else if (current.type === "question_answered") {
      if (!questions.has(current.payload.question_id)) throw new Error(`${record.listing_id}: unknown question ${current.payload.question_id}`);
      if (questions.get(current.payload.question_id)) throw new Error(`${record.listing_id}: question already answered ${current.payload.question_id}`);
      questions.set(current.payload.question_id, true);
    } else if (current.type === "visit_recorded" && new Date(current.payload.visited_at) > new Date(current.recorded_at)) {
      throw new Error(`${record.listing_id}: visit time cannot be after its recording time`);
    }
  }
  return { state, availability, created_at: record.events[0].recorded_at, updated_at: record.events.at(-1).recorded_at };
}

export function assertTrackerIntegrity(records, listings) {
  const listingIds = new Set(listings.map((listing) => listing.id));
  const tracked = new Set();
  for (const record of records) {
    if (tracked.has(record.listing_id)) throw new Error(`Duplicate tracker record: ${record.listing_id}`);
    tracked.add(record.listing_id);
    if (!listingIds.has(record.listing_id)) throw new Error(`Tracker references missing listing: ${record.listing_id}`);
    const projection = replayTrackerRecord(record);
    for (const field of ["state", "availability", "created_at", "updated_at"]) {
      if (record[field] !== projection[field]) throw new Error(`${record.listing_id}: ${field} does not match event history`);
    }
  }
  return true;
}

function actionEvent(record, action, now) {
  if (action.type === "transition") {
    if (!TRACKER_STATES.includes(action.to)) throw new Error(`Unknown tracker state: ${action.to}`);
    if (!TRANSITIONS[record.state].has(action.to)) throw new Error(`Invalid state transition: ${record.state} -> ${action.to}`);
    return event(record.listing_id, "state_changed", now, { from: record.state, to: action.to });
  }
  if (action.type === "availability") {
    if (!AVAILABILITY_STATES.includes(action.to)) throw new Error(`Unknown availability: ${action.to}`);
    if (record.availability === action.to) throw new Error(`Availability is already ${action.to}`);
    return event(record.listing_id, "availability_changed", now, { from: record.availability, to: action.to });
  }
  if (action.type === "note") return event(record.listing_id, "note_added", now, { text: action.text });
  if (action.type === "question") return event(record.listing_id, "question_added", now, { text: action.text });
  if (action.type === "answer") return event(record.listing_id, "question_answered", now, { question_id: action.questionId, text: action.text });
  if (action.type === "visit") return event(record.listing_id, "visit_recorded", now, { visited_at: action.visitedAt, notes: action.notes ?? null });
  if (action.type === "decision") return event(record.listing_id, "decision_recorded", now, { decision: action.decision, reason: action.reason ?? null });
  throw new Error(`Unknown tracker action: ${action.type}`);
}

export function applyTrackerAction(records, listingId, action, now) {
  const byId = new Map(records.map((record) => [record.listing_id, record]));
  let record = byId.get(listingId);
  if (action.type === "start") {
    if (record) throw new Error(`Listing is already tracked: ${listingId}`);
    const first = event(listingId, "tracking_started", now, { state: "watching", availability: "unknown" });
    record = {
      schema_version: 1,
      listing_id: listingId,
      state: "watching",
      availability: "unknown",
      created_at: now,
      updated_at: now,
      events: [first]
    };
    byId.set(listingId, record);
    return { records: [...byId.values()].sort((a, b) => a.listing_id.localeCompare(b.listing_id)), record, changed: true, event: first };
  }
  if (!record) throw new Error(`Listing is not tracked: ${listingId}`);
  const nextEvent = actionEvent(record, action, now);
  if (record.events.some((existing) => existing.id === nextEvent.id)) return { records, record, changed: false, event: nextEvent };
  const updated = { ...record, events: [...record.events, nextEvent], updated_at: now };
  if (nextEvent.type === "state_changed") updated.state = nextEvent.payload.to;
  if (nextEvent.type === "availability_changed") updated.availability = nextEvent.payload.to;
  replayTrackerRecord(updated);
  byId.set(listingId, updated);
  return { records: [...byId.values()].sort((a, b) => a.listing_id.localeCompare(b.listing_id)), record: updated, changed: true, event: nextEvent };
}
