export const DAY_MS = 86_400_000;

export function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `item-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function todayISO(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseLocalDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return null;
  return date;
}

export function daysUntil(value, now = new Date()) {
  const date = parseLocalDate(value);
  if (!date) return Number.POSITIVE_INFINITY;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((date.getTime() - start.getTime()) / DAY_MS);
}

export function expiryState(value, now = new Date()) {
  const days = daysUntil(value, now);
  if (days < 0) return "expired";
  if (days <= 3) return "soon";
  return "later";
}

export function relativeExpiry(value, now = new Date()) {
  const days = daysUntil(value, now);
  if (!Number.isFinite(days)) return "Invalid date";
  if (days === 0) return "Expires today";
  if (days === 1) return "Expires tomorrow";
  if (days === -1) return "Expired yesterday";
  if (days < 0) return `Expired ${Math.abs(days)} days ago`;
  return `Expires in ${days} days`;
}

export function normalizeItem(raw = {}) {
  const now = new Date().toISOString();
  return {
    id: String(raw.id || makeId()),
    name: String(raw.name || "").trim(),
    expiryDate: String(raw.expiryDate || raw.expiry || ""),
    quantity: raw.quantity === "" || raw.quantity == null ? null : Number(raw.quantity),
    unit: String(raw.unit || "").trim(),
    location: String(raw.location || "Fridge"),
    notes: String(raw.notes || "").trim(),
    barcode: String(raw.barcode || "").trim(),
    brand: String(raw.brand || "").trim(),
    groceryItemId: raw.groceryItemId ? String(raw.groceryItemId) : null,
    status: ["active", "used", "wasted", "frozen"].includes(raw.status) ? raw.status : "active",
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
    completedAt: raw.completedAt || null,
  };
}

export function normalizeProductName(value = "") {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\byoghurt\b/g, "yogurt")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function findMatchingGroceryItem(food, groceries = []) {
  if (food?.groceryItemId) {
    const linked = groceries.find((item) => item.id === food.groceryItemId);
    if (linked) return linked;
  }
  const foodName = normalizeProductName(food?.name);
  if (!foodName) return null;
  const exact = groceries.find((item) => normalizeProductName(item.name) === foodName);
  if (exact) return exact;
  const contained = groceries
    .filter((item) => {
      const groceryName = normalizeProductName(item.name);
      return groceryName.length >= 4 && (` ${foodName} `).includes(` ${groceryName} `);
    })
    .sort((a, b) => normalizeProductName(b.name).length - normalizeProductName(a.name).length);
  return contained[0] || null;
}

export function hasActiveGroceryMatch(grocery, foods = [], excludedId = null) {
  return foods.some((food) => food.id !== excludedId && food.status === "active" && findMatchingGroceryItem(food, [grocery])?.id === grocery.id);
}

function gs1Date(value) {
  if (!/^\d{6}$/.test(value || "")) return "";
  const year = 2000 + Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  let day = Number(value.slice(4, 6));
  if (day === 0 && month >= 1 && month <= 12) day = new Date(year, month, 0).getDate();
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return parseLocalDate(iso) ? iso : "";
}

export function parseGS1Barcode(raw = "") {
  const value = String(raw).trim().replace(/^\][A-Za-z]\d/, "");
  const parenthesizedGtin = value.match(/\(01\)(\d{14})/);
  const compactGtin = !parenthesizedGtin && value.match(/^01(\d{14})/);
  const gtin = parenthesizedGtin?.[1] || compactGtin?.[1] || "";
  const expiry = value.match(/\(17\)(\d{6})/) || (gtin ? value.slice(16).match(/(?:^|\x1d)17(\d{6})/) : null);
  const bestBefore = value.match(/\(15\)(\d{6})/) || (gtin ? value.slice(16).match(/(?:^|\x1d)15(\d{6})/) : null);
  return {
    barcode: gtin || value.replace(/\D/g, ""),
    expiryDate: gs1Date(expiry?.[1]) || gs1Date(bestBefore?.[1]),
    dateType: expiry ? "expiry" : bestBefore ? "best-before" : "",
  };
}

export function parsePackageQuantity(value = "") {
  const match = String(value).trim().match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
  if (!match) return { quantity: null, unit: "" };
  return { quantity: Number(match[1].replace(",", ".")), unit: match[2].trim().slice(0, 24) };
}

export function normalizeGroceryItem(raw = {}) {
  const now = new Date().toISOString();
  return {
    id: String(raw.id || makeId()),
    name: String(raw.name || "").trim(),
    quantity: String(raw.quantity || "").trim(),
    store: String(raw.store || "Other").trim() || "Other",
    have: Boolean(raw.have),
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
  };
}

export function validateGroceryItem(item) {
  if (!item.name) return "Enter an item name.";
  if (!item.store) return "Choose a store.";
  return "";
}

export function validateItem(item) {
  if (!item.name) return "Enter a food name.";
  if (!parseLocalDate(item.expiryDate)) return "Choose a valid expiry date.";
  if (item.quantity != null && (!Number.isFinite(item.quantity) || item.quantity < 0)) return "Quantity must be zero or more.";
  return "";
}

export function addDaysISO(days, date = new Date()) {
  return todayISO(new Date(date.getFullYear(), date.getMonth(), date.getDate() + Number(days)));
}

export function groupActiveItems(items, now = new Date()) {
  const groups = { expired: [], soon: [], later: [] };
  items.filter((item) => item.status === "active").forEach((item) => groups[expiryState(item.expiryDate, now)].push(item));
  return groups;
}

export function outcomeCounts(items, now = new Date(), days = 30) {
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  return items.reduce((counts, item) => {
    if (item.status !== "active" && item.completedAt && new Date(item.completedAt) >= cutoff) counts[item.status] += 1;
    return counts;
  }, { used: 0, wasted: 0, frozen: 0 });
}

export function recentFoodTemplates(items, limit = 6) {
  const seen = new Set();
  return [...items]
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
    .filter((item) => {
      const key = item.name.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}
