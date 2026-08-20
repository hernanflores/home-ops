import { createHash } from "node:crypto";
import { normalizedKey } from "./normalize.mjs";

function relativeDifference(left, right) {
  if (left === null || right === null || left === 0 || right === 0) return Infinity;
  return Math.abs(left - right) / Math.min(left, right);
}

function normalizedAddress(value) {
  return normalizedKey(value)
    .replace(/^av\b/, "avenida")
    .replace(/^bv\b/, "bulevar")
    .replace(/^gral\b/, "general");
}

function candidate(left, right) {
  if (left.source.provider === right.source.provider) return null;
  if (left.source.url && left.source.url === right.source.url) {
    return { confidence: "high", reasons: ["same normalized source URL"] };
  }
  const a = left.property;
  const b = right.property;
  if (a.operation !== b.operation || a.property_type !== b.property_type) return null;

  const leftAddress = normalizedAddress(a.location.address);
  const rightAddress = normalizedAddress(b.location.address);
  if (leftAddress && leftAddress === rightAddress && normalizedKey(a.location.city) === normalizedKey(b.location.city)) {
    return { confidence: "high", reasons: ["same normalized address", "same operation and property type"] };
  }

  const sameNeighborhood = normalizedKey(a.location.neighborhood)
    && normalizedKey(a.location.neighborhood) === normalizedKey(b.location.neighborhood);
  const sameBedrooms = a.features.bedrooms !== null && a.features.bedrooms === b.features.bedrooms;
  const similarPrice = relativeDifference(a.pricing.price, b.pricing.price) <= 0.02
    && a.pricing.currency === b.pricing.currency;
  const similarArea = relativeDifference(a.features.area_total_m2, b.features.area_total_m2) <= 0.05;
  if (sameNeighborhood && sameBedrooms && similarPrice && similarArea) {
    return { confidence: "medium", reasons: ["same neighborhood and bedrooms", "price within 2%", "area within 5%"] };
  }
  return null;
}

export function assignDuplicateGroups(listings) {
  const links = new Map(listings.map((listing) => [listing.id, new Set()]));
  const findings = new Map();

  for (let left = 0; left < listings.length; left += 1) {
    for (let right = left + 1; right < listings.length; right += 1) {
      const result = candidate(listings[left], listings[right]);
      if (!result) continue;
      links.get(listings[left].id).add(listings[right].id);
      links.get(listings[right].id).add(listings[left].id);
      findings.set([listings[left].id, listings[right].id].sort().join(":"), result);
    }
  }

  const byId = new Map(listings.map((listing) => [listing.id, listing]));
  const visited = new Set();
  for (const listing of listings) {
    if (visited.has(listing.id) || links.get(listing.id).size === 0) {
      if (links.get(listing.id).size === 0) listing.duplicate = { group_id: null, confidence: "none", reasons: [] };
      continue;
    }
    const stack = [listing.id];
    const component = [];
    while (stack.length > 0) {
      const id = stack.pop();
      if (visited.has(id)) continue;
      visited.add(id);
      component.push(id);
      stack.push(...links.get(id));
    }
    component.sort();
    const groupId = `dup_${createHash("sha256").update(component.join("\0")).digest("hex").slice(0, 12)}`;
    for (const id of component) {
      const relevant = [];
      let confidence = "medium";
      for (const other of component) {
        const key = [id, other].sort().join(":");
        const finding = findings.get(key);
        if (!finding) continue;
        relevant.push(...finding.reasons);
        if (finding.confidence === "high") confidence = "high";
      }
      byId.get(id).duplicate = { group_id: groupId, confidence, reasons: [...new Set(relevant)] };
    }
  }
}
