import test from "node:test";
import assert from "node:assert/strict";
import {
  addDaysISO, daysUntil, expiryState, extractOCRDate, extractOCRDates, groupActiveItems,
  normalizeItem, outcomeCounts, parseLocalDate, recentFoodTemplates, relativeExpiry, validateItem
} from "./utils.js";

const now = new Date(2026, 8, 20, 12);

test("date math uses calendar dates without UTC shifts", () => {
  assert.equal(daysUntil("2026-09-20", now), 0);
  assert.equal(daysUntil("2026-09-23", now), 3);
  assert.equal(expiryState("2026-09-19", now), "expired");
  assert.equal(expiryState("2026-09-23", now), "soon");
  assert.equal(expiryState("2026-09-24", now), "later");
  assert.equal(relativeExpiry("2026-09-21", now), "Expires tomorrow");
});

test("invalid calendar dates are rejected", () => {
  assert.equal(parseLocalDate("2026-02-30"), null);
  assert.equal(validateItem(normalizeItem({ name: "Milk", expiry: "2026-02-30" })), "Choose a valid expiry date.");
});

test("legacy items are normalized into the new schema", () => {
  const item = normalizeItem({ name: " Milk ", expiry: "2026-09-23" });
  assert.equal(item.name, "Milk");
  assert.equal(item.expiryDate, "2026-09-23");
  assert.equal(item.status, "active");
  assert.ok(item.id);
});

test("active items are grouped without used items", () => {
  const groups = groupActiveItems([
    normalizeItem({ name: "Old", expiry: "2026-09-19" }),
    normalizeItem({ name: "Soon", expiry: "2026-09-22" }),
    normalizeItem({ name: "Later", expiry: "2026-10-01" }),
    normalizeItem({ name: "Used", expiry: "2026-09-22", status: "used" }),
  ], now);
  assert.deepEqual(Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, value.length])), { expired: 1, soon: 1, later: 1 });
});

test("date shortcuts and OCR return valid ISO dates", () => {
  assert.equal(addDaysISO(7, now), "2026-09-27");
  assert.equal(extractOCRDate("BEST BEFORE 24/09/2026", now), "2026-09-24");
  assert.equal(extractOCRDate("EXP 2026-10-03", now), "2026-10-03");
  assert.deepEqual(extractOCRDates("PACK 2026-10-03 USE BY 04/10/2026", now), ["2026-10-03", "2026-10-04"]);
});

test("outcomes include used, wasted, and frozen within the selected period", () => {
  const completedAt = new Date(2026, 8, 18).toISOString();
  const old = new Date(2026, 6, 1).toISOString();
  const counts = outcomeCounts([
    normalizeItem({ name: "Used", expiry: "2026-09-18", status: "used", completedAt }),
    normalizeItem({ name: "Wasted", expiry: "2026-09-18", status: "wasted", completedAt }),
    normalizeItem({ name: "Frozen", expiry: "2026-09-18", status: "frozen", completedAt }),
    normalizeItem({ name: "Old", expiry: "2026-07-01", status: "wasted", completedAt: old }),
  ], now);
  assert.deepEqual(counts, { used: 1, wasted: 1, frozen: 1 });
});

test("recent food templates are unique and ordered by latest update", () => {
  const templates = recentFoodTemplates([
    normalizeItem({ name: "Milk", expiry: "2026-09-22", updatedAt: "2026-09-18T00:00:00Z" }),
    normalizeItem({ name: "Eggs", expiry: "2026-09-24", updatedAt: "2026-09-19T00:00:00Z" }),
    normalizeItem({ name: "milk", expiry: "2026-09-25", updatedAt: "2026-09-20T00:00:00Z" }),
  ]);
  assert.deepEqual(templates.map((item) => item.name), ["milk", "Eggs"]);
});
