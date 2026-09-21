import test from "node:test";
import assert from "node:assert/strict";
import {
  addDaysISO, createOutcomeRecords, daysUntil, effectiveExpiryDate, expiryState, findMatchingFoodTemplate, findMatchingGroceryItem, groupActiveItems,
  activeProductQuantity, configuredLowStockThreshold, configuredTargetQuantity, hasActiveGroceryMatch, isLowStock, normalizeFoodTemplate, normalizeGroceryItem, normalizeItem, outcomeCounts,
  parseGS1Barcode, parseLocalDate, parsePackageQuantity, recentFoodTemplates,
  relativeExpiry, shoppingProgress, suggestedRestockQuantity, validateGroceryItem, validateItem
} from "./utils.js";
import { DEFAULT_GROCERY_ITEMS } from "./grocery-data.js";

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
  assert.equal(validateItem(normalizeItem({ name: "Milk", expiry: "2026-09-25", openedDate: "2026-02-30" })), "Choose a valid opened date.");
  assert.equal(validateItem(normalizeItem({ name: "Milk", expiry: "2026-09-25", afterOpeningDays: 0 })), "After-opening lifetime must be at least one day.");
  assert.equal(validateItem(normalizeItem({ name: "Milk", expiry: "2026-09-25", lowStockThreshold: -1 })), "Low-stock level must be zero or more.");
  assert.equal(validateItem(normalizeItem({ name: "Milk", expiry: "2026-09-25", lowStockThreshold: 2, targetQuantity: 2 })), "Target stock must be greater than the low-stock level.");
});

test("legacy items are normalized into the new schema", () => {
  const item = normalizeItem({ name: " Milk ", expiry: "2026-09-23", openedDate: "2026-09-20", barcode: " 123 ", brand: " Farm " });
  assert.equal(item.name, "Milk");
  assert.equal(item.expiryDate, "2026-09-23");
  assert.equal(item.status, "active");
  assert.equal(item.barcode, "123");
  assert.equal(item.brand, "Farm");
  assert.equal(item.openedDate, "2026-09-20");
  assert.ok(item.id);
});

test("GS1 barcodes provide GTIN and expiry or best-before dates", () => {
  assert.deepEqual(parseGS1Barcode("(01)00628123456789(17)270915"), {
    barcode: "00628123456789", expiryDate: "2027-09-15", dateType: "expiry",
  });
  assert.deepEqual(parseGS1Barcode("010062812345678915271200"), {
    barcode: "00628123456789", expiryDate: "2027-12-31", dateType: "best-before",
  });
  assert.deepEqual(parseGS1Barcode("628123456789"), {
    barcode: "628123456789", expiryDate: "", dateType: "",
  });
});

test("package quantities are split into editable quantity and unit fields", () => {
  assert.deepEqual(parsePackageQuantity("1.5 L"), { quantity: 1.5, unit: "L" });
  assert.deepEqual(parsePackageQuantity("12 x 355 mL"), { quantity: 12, unit: "x 355 mL" });
});

test("inventory names match the reusable grocery list", () => {
  const groceries = [
    normalizeGroceryItem({ id: "milk", name: "Milk", store: "Walmart" }),
    normalizeGroceryItem({ id: "yogurt", name: "Greek yoghurt", store: "Walmart" }),
  ];
  assert.equal(findMatchingGroceryItem({ name: "Great Value Milk" }, groceries)?.id, "milk");
  assert.equal(findMatchingGroceryItem({ name: "Oikos Greek Yogurt" }, groceries)?.id, "yogurt");
  assert.equal(findMatchingGroceryItem({ name: "Chocolate" }, groceries), null);
  assert.equal(hasActiveGroceryMatch(groceries[0], [normalizeItem({ id: "food", name: "Milk", expiry: "2026-09-23" })]), true);
  assert.equal(hasActiveGroceryMatch(groceries[0], [normalizeItem({ id: "food", name: "Milk", expiry: "2026-09-23", status: "used" })]), false);
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

test("date shortcuts return valid ISO dates", () => {
  assert.equal(addDaysISO(7, now), "2026-09-27");
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

test("default grocery list preserves stores, quantities, and have state", () => {
  assert.equal(DEFAULT_GROCERY_ITEMS.length, 57);
  assert.equal(DEFAULT_GROCERY_ITEMS.filter((item) => item.store === "Dollarama").length, 9);
  assert.equal(DEFAULT_GROCERY_ITEMS.filter((item) => !item.have).length, 23);
  assert.equal(DEFAULT_GROCERY_ITEMS.filter((item) => item.store === "Dollarama" && !item.have).length, 0);
  assert.equal(DEFAULT_GROCERY_ITEMS.find((item) => item.name === "Tomato").quantity, "3");
  assert.equal(DEFAULT_GROCERY_ITEMS.find((item) => item.name === "Mixed Vegetables").have, true);
  assert.equal(DEFAULT_GROCERY_ITEMS.find((item) => item.name === "Chicken Breast").have, false);
});

test("grocery items normalize and validate independently from food inventory", () => {
  const item = normalizeGroceryItem({ name: " Milk ", store: "Walmart", quantity: "2", have: false });
  assert.equal(item.name, "Milk");
  assert.equal(item.quantity, "2");
  assert.equal(validateGroceryItem(item), "");
  assert.equal(validateGroceryItem(normalizeGroceryItem({ name: "", store: "Walmart" })), "Enter an item name.");
});

test("after-opening lifetime uses the earlier of its use-by date and label expiry", () => {
  const opened = normalizeItem({ name: "Milk", expiry: "2026-10-20", openedDate: "2026-09-20", afterOpeningDays: 7 });
  const labelSooner = normalizeItem({ name: "Milk", expiry: "2026-09-24", openedDate: "2026-09-20", afterOpeningDays: 7 });
  assert.equal(effectiveExpiryDate(opened), "2026-09-27");
  assert.equal(effectiveExpiryDate(labelSooner), "2026-09-24");
  assert.equal(effectiveExpiryDate(normalizeItem({ name: "Eggs", expiry: "2026-10-01" })), "2026-10-01");
});

test("favourite food templates persist reusable product details and match items", () => {
  const template = normalizeFoodTemplate({
    id: "template-milk", name: " Milk ", quantity: "2", unit: "cartons", location: "Fridge",
    brand: "Farm", barcode: "00628123456789", lowStockThreshold: 1, targetQuantity: 4,
  });
  assert.equal(template.name, "Milk");
  assert.equal(template.quantity, 2);
  assert.equal(template.lowStockThreshold, 1);
  assert.equal(template.targetQuantity, 4);
  assert.equal(findMatchingFoodTemplate({ favoriteTemplateId: "template-milk" }, [template]), template);
  assert.equal(findMatchingFoodTemplate({ name: "Milk", barcode: "628123456789" }, [template]), template);
  assert.equal(findMatchingFoodTemplate({ name: "Eggs" }, [template]), null);
});

test("low-stock levels aggregate active batches of the same product", () => {
  const reference = normalizeItem({ id: "milk-a", name: "Milk", expiry: "2026-09-25", quantity: 1, lowStockThreshold: 2 });
  const another = normalizeItem({ id: "milk-b", name: "Milk", expiry: "2026-09-26", quantity: 2 });
  const used = normalizeItem({ id: "milk-c", name: "Milk", expiry: "2026-09-24", quantity: 5, status: "used" });
  assert.equal(activeProductQuantity(reference, [reference, another, used]), 3);
  assert.equal(isLowStock(reference, [reference, another, used]), false);
  assert.equal(isLowStock(reference, [reference, used]), true);
  const template = normalizeFoodTemplate({ name: "Milk", lowStockThreshold: 4 });
  assert.equal(configuredLowStockThreshold({ name: "Milk" }, [another], [template]), 4);
  assert.equal(configuredLowStockThreshold({ name: "Eggs" }, [another], [template]), null);
});

test("suggested shopping quantity fills the configured target from current stock", () => {
  const template = normalizeFoodTemplate({ name: "Eggs", targetQuantity: 12 });
  const stock = [normalizeItem({ name: "Eggs", expiry: "2026-09-25", quantity: 4 })];
  assert.equal(configuredTargetQuantity({ name: "Eggs" }, stock, [template]), 12);
  assert.equal(suggestedRestockQuantity({ name: "Eggs" }, stock, [template]), 8);
  assert.equal(suggestedRestockQuantity({ name: "Eggs", targetQuantity: 3 }, stock, [template]), 0);
});

test("shopping progress keeps purchased items in the active trip total", () => {
  const groceries = [
    normalizeGroceryItem({ id: "milk", name: "Milk", have: true }),
    normalizeGroceryItem({ id: "eggs", name: "Eggs", have: false }),
    normalizeGroceryItem({ id: "bread", name: "Bread", have: true }),
  ];
  assert.deepEqual(shoppingProgress(groceries, ["milk", "eggs"]), { bought: 1, total: 2, remaining: 1 });
});

test("partial outcomes retain the remainder and create a separate history record", () => {
  const item = normalizeItem({ id: "eggs", name: "Eggs", expiry: "2026-09-24", quantity: 12, unit: "eggs" });
  const result = createOutcomeRecords(item, "used", 2, "2026-09-20T20:00:00.000Z", "used-eggs");
  assert.equal(result.partial, true);
  assert.equal(result.remaining.id, "eggs");
  assert.equal(result.remaining.quantity, 10);
  assert.equal(result.remaining.status, "active");
  assert.equal(result.completed.id, "used-eggs");
  assert.equal(result.completed.quantity, 2);
  assert.equal(result.completed.status, "used");
  assert.equal(result.completed.sourceItemId, "eggs");
});

test("outcomes reject invalid partial quantities and complete the full amount", () => {
  const item = normalizeItem({ id: "milk", name: "Milk", expiry: "2026-09-24", quantity: 2, unit: "cartons" });
  assert.throws(() => createOutcomeRecords(item, "wasted", 3), /between 0 and 2/);
  const result = createOutcomeRecords(item, "wasted", 2, "2026-09-20T20:00:00.000Z");
  assert.equal(result.partial, false);
  assert.equal(result.remaining, null);
  assert.equal(result.completed.id, "milk");
  assert.equal(result.completed.status, "wasted");
});
