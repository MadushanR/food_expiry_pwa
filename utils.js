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
    openedDate: String(raw.openedDate || ""),
    freezeByDate: String(raw.freezeByDate || ""),
    thawedDate: String(raw.thawedDate || ""),
    originalExpiryDate: String(raw.originalExpiryDate || ""),
    afterOpeningDays: raw.afterOpeningDays === "" || raw.afterOpeningDays == null ? null : Number(raw.afterOpeningDays),
    lowStockThreshold: raw.lowStockThreshold === "" || raw.lowStockThreshold == null ? null : Number(raw.lowStockThreshold),
    targetQuantity: raw.targetQuantity === "" || raw.targetQuantity == null ? null : Number(raw.targetQuantity),
    quantity: raw.quantity === "" || raw.quantity == null ? null : Number(raw.quantity),
    unit: String(raw.unit || "").trim(),
    location: String(raw.location || "Fridge"),
    notes: String(raw.notes || "").trim(),
    barcode: String(raw.barcode || "").trim(),
    brand: String(raw.brand || "").trim(),
    groceryItemId: raw.groceryItemId ? String(raw.groceryItemId) : null,
    favoriteTemplateId: raw.favoriteTemplateId ? String(raw.favoriteTemplateId) : null,
    sourceItemId: raw.sourceItemId ? String(raw.sourceItemId) : null,
    status: ["active", "used", "wasted", "frozen"].includes(raw.status) ? raw.status : "active",
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
    completedAt: raw.completedAt || null,
  };
}

export function createOutcomeRecords(item, status, amount, completedAt = new Date().toISOString(), completedId = makeId()) {
  if (!["used", "wasted", "frozen"].includes(status)) throw new Error("Choose a valid outcome.");
  const quantity = item.quantity == null ? null : Number(item.quantity);
  const selected = amount === "" || amount == null ? quantity : Number(amount);
  if (quantity != null && (!Number.isFinite(selected) || selected <= 0 || selected > quantity)) {
    throw new Error(`Enter an amount between 0 and ${quantity}.`);
  }
  if (quantity == null || selected === quantity) {
    return {
      remaining: null,
      completed: normalizeItem({ ...item, status, completedAt, updatedAt: completedAt }),
      partial: false,
    };
  }
  return {
    remaining: normalizeItem({ ...item, quantity: quantity - selected, status: "active", completedAt: null, updatedAt: completedAt }),
    completed: normalizeItem({
      ...item, id: completedId, sourceItemId: item.id, quantity: selected, status,
      createdAt: completedAt, updatedAt: completedAt, completedAt,
    }),
    partial: true,
  };
}

export function normalizeFoodTemplate(raw = {}) {
  const now = new Date().toISOString();
  return {
    id: String(raw.id || makeId()),
    name: String(raw.name || "").trim(),
    quantity: raw.quantity === "" || raw.quantity == null ? null : Number(raw.quantity),
    unit: String(raw.unit || "").trim(),
    location: String(raw.location || "Fridge"),
    brand: String(raw.brand || "").trim(),
    barcode: String(raw.barcode || "").trim(),
    afterOpeningDays: raw.afterOpeningDays === "" || raw.afterOpeningDays == null ? null : Number(raw.afterOpeningDays),
    lowStockThreshold: raw.lowStockThreshold === "" || raw.lowStockThreshold == null ? null : Number(raw.lowStockThreshold),
    targetQuantity: raw.targetQuantity === "" || raw.targetQuantity == null ? null : Number(raw.targetQuantity),
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
  };
}

export function findMatchingFoodTemplate(food, templates = []) {
  if (food?.favoriteTemplateId) {
    const linked = templates.find((template) => template.id === food.favoriteTemplateId);
    if (linked) return linked;
  }
  const barcode = String(food?.barcode || "").replace(/^0+/, "");
  if (barcode) {
    const barcodeMatch = templates.find((template) => String(template.barcode || "").replace(/^0+/, "") === barcode);
    if (barcodeMatch) return barcodeMatch;
  }
  const name = normalizeProductName(food?.name);
  return name ? templates.find((template) => normalizeProductName(template.name) === name) || null : null;
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

export function sameProduct(first, second) {
  if (first?.favoriteTemplateId && second?.favoriteTemplateId && first.favoriteTemplateId === second.favoriteTemplateId) return true;
  const firstBarcode = String(first?.barcode || "").replace(/^0+/, "");
  const secondBarcode = String(second?.barcode || "").replace(/^0+/, "");
  if (firstBarcode && secondBarcode && firstBarcode === secondBarcode) return true;
  const firstName = normalizeProductName(first?.name);
  return Boolean(firstName && firstName === normalizeProductName(second?.name));
}

export function activeProductQuantity(reference, foods = []) {
  return foods
    .filter((food) => food.status === "active" && sameProduct(reference, food))
    .reduce((total, food) => total + (food.quantity == null ? 1 : Number(food.quantity)), 0);
}

export function isLowStock(reference, foods = []) {
  return reference?.lowStockThreshold != null && activeProductQuantity(reference, foods) <= Number(reference.lowStockThreshold);
}

export function configuredLowStockThreshold(reference, foods = [], templates = []) {
  if (reference?.lowStockThreshold != null) return Number(reference.lowStockThreshold);
  const template = findMatchingFoodTemplate(reference, templates);
  if (template?.lowStockThreshold != null) return Number(template.lowStockThreshold);
  const matchingFood = foods.find((food) => sameProduct(reference, food) && food.lowStockThreshold != null);
  return matchingFood ? Number(matchingFood.lowStockThreshold) : null;
}

export function configuredTargetQuantity(reference, foods = [], templates = []) {
  if (reference?.targetQuantity != null) return Number(reference.targetQuantity);
  const template = findMatchingFoodTemplate(reference, templates);
  if (template?.targetQuantity != null) return Number(template.targetQuantity);
  const matchingFood = foods.find((food) => sameProduct(reference, food) && food.targetQuantity != null);
  return matchingFood ? Number(matchingFood.targetQuantity) : null;
}

export function suggestedRestockQuantity(reference, foods = [], templates = []) {
  const target = configuredTargetQuantity(reference, foods, templates);
  if (target == null) return null;
  return Math.max(0, target - activeProductQuantity(reference, foods));
}

export function shoppingProgress(groceries = [], itemIds = []) {
  const selected = itemIds.map((id) => groceries.find((item) => item.id === id)).filter(Boolean);
  const bought = selected.filter((item) => item.have).length;
  return { bought, total: selected.length, remaining: selected.length - bought };
}

export function normalizeShoppingTrip(raw = {}) {
  const completedAt = raw.completedAt || new Date().toISOString();
  return {
    id: String(raw.id || makeId()),
    store: String(raw.store || "Other"),
    completedAt,
    items: Array.isArray(raw.items) ? raw.items.map((item) => ({
      groceryItemId: item.groceryItemId ? String(item.groceryItemId) : null,
      name: String(item.name || "").trim(),
      quantity: String(item.quantity || "").trim(),
      store: String(item.store || raw.store || "Other"),
    })).filter((item) => item.name) : [],
  };
}

export function calendarGridDates(year, monthIndex) {
  const first = new Date(year, monthIndex, 1);
  const start = new Date(year, monthIndex, 1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => todayISO(new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)));
}

export function normalizeGroceryItem(raw = {}) {
  const now = new Date().toISOString();
  return {
    id: String(raw.id || makeId()),
    name: String(raw.name || "").trim(),
    quantity: String(raw.quantity || "").trim(),
    suggestedQuantity: String(raw.suggestedQuantity || "").trim(),
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
  if (item.openedDate && !parseLocalDate(item.openedDate)) return "Choose a valid opened date.";
  if (item.freezeByDate && !parseLocalDate(item.freezeByDate)) return "Choose a valid freeze-by date.";
  if (item.thawedDate && !parseLocalDate(item.thawedDate)) return "Choose a valid thawed date.";
  if (item.afterOpeningDays != null && (!Number.isInteger(item.afterOpeningDays) || item.afterOpeningDays < 1)) return "After-opening lifetime must be at least one day.";
  if (item.lowStockThreshold != null && (!Number.isFinite(item.lowStockThreshold) || item.lowStockThreshold < 0)) return "Low-stock level must be zero or more.";
  if (item.targetQuantity != null && (!Number.isFinite(item.targetQuantity) || item.targetQuantity < 0)) return "Target stock must be zero or more.";
  if (item.targetQuantity != null && item.lowStockThreshold != null && item.targetQuantity <= item.lowStockThreshold) return "Target stock must be greater than the low-stock level.";
  if (item.quantity != null && (!Number.isFinite(item.quantity) || item.quantity < 0)) return "Quantity must be zero or more.";
  return "";
}

export function effectiveExpiryDate(item) {
  if (!item?.openedDate || !item?.afterOpeningDays || !parseLocalDate(item.openedDate)) return item?.expiryDate || "";
  const openedUseBy = addDaysISO(item.afterOpeningDays, parseLocalDate(item.openedDate));
  if (!parseLocalDate(item.expiryDate)) return openedUseBy;
  return openedUseBy < item.expiryDate ? openedUseBy : item.expiryDate;
}

export function useFirstPriority(item, now = new Date()) {
  const days = daysUntil(effectiveExpiryDate(item), now);
  let score = days < 0 ? 120 + Math.min(20, Math.abs(days)) : days === 0 ? 110 : days <= 3 ? 95 - days * 5 : days <= 7 ? 65 - days : Math.max(0, 30 - days);
  const reasons = [relativeExpiry(effectiveExpiryDate(item), now).toLowerCase()];
  if (item.openedDate) { score += 15; reasons.push("already opened"); }
  const quantity = item.quantity == null ? null : Number(item.quantity);
  if (quantity != null && quantity > 1) { score += Math.min(10, Math.ceil(quantity)); reasons.push(`${quantity}${item.unit ? ` ${item.unit}` : ""} remaining`); }
  const storagePoints = { Counter: 12, Fridge: 7, Pantry: 3, Freezer: 0, Other: 2 };
  score += storagePoints[item.location] ?? 2;
  if (item.location === "Counter" || item.location === "Fridge") reasons.push(`kept in ${item.location.toLowerCase()}`);
  return { score, reason: reasons.join(" · ") };
}

export function suggestFreezeByDate(item, now = new Date()) {
  if (!item || item.location === "Freezer") return "";
  const name = normalizeProductName(item.name);
  const groups = [
    { pattern: /chicken|salmon|fish|beef|pork|meat|turkey|paneer|tofu/, lead: 2 },
    { pattern: /bread|tortilla/, lead: 3 },
    { pattern: /milk|yogurt|cottage cheese/, lead: 2 },
  ];
  const group = groups.find((entry) => entry.pattern.test(name)); if (!group) return "";
  const effective = effectiveExpiryDate(item); const useBy = parseLocalDate(effective);
  if (!useBy || daysUntil(effective, now) < 0) return "";
  const proposed = todayISO(new Date(useBy.getFullYear(), useBy.getMonth(), useBy.getDate() - group.lead));
  return proposed < todayISO(now) ? todayISO(now) : proposed;
}

export function suggestThawUseByDate(item, thawedDate = todayISO()) {
  const thawed = parseLocalDate(thawedDate); if (!thawed) return "";
  const name = normalizeProductName(item?.name);
  const days = /fish|salmon|chicken|turkey|meat/.test(name) ? 1 : /bread|tortilla/.test(name) ? 3 : 2;
  return addDaysISO(days, thawed);
}

export function storageGuidance(item) {
  const name = normalizeProductName(item?.name);
  if (item?.location === "Freezer") return "Keep the freezer at −18°C (0°F) or lower. Thaw meat, poultry, fish, and seafood in the fridge, microwave, or cold water—not on the counter.";
  if (/chicken|turkey|beef|pork|meat|salmon|fish|seafood/.test(name)) return "Keep refrigerated at 4°C (40°F) or lower in a sealed container on the bottom shelf so raw juices cannot drip onto other food.";
  if (/leftover|cooked|stew|egg dish|soup/.test(name)) return "Refrigerate promptly. Most cooked leftovers keep 3–4 days at 4°C or lower; soups are generally 2–3 days.";
  if (/milk|yogurt|cottage cheese/.test(name)) return "Keep refrigerated at 4°C or lower. Government guidance lists opened milk, yogurt, and cottage cheese for about 4 days; follow the package when stricter.";
  if (/egg/.test(name)) return "Keep shell eggs refrigerated. Do not freeze eggs in their shells; out-of-shell eggs can be frozen in a suitable container.";
  if (/tomato/.test(name)) return "Whole tomatoes are generally stored outside the refrigerator. Refrigerate them after cutting.";
  if (/lettuce|salad|spinach|berr|cut fruit|mixed vegetable/.test(name)) return "Keep cut or ready-to-eat produce refrigerated at 4°C or lower in a clean container.";
  if (item?.location === "Pantry") return "Keep in a cool, dry place and follow any storage instructions printed on the package.";
  return "Follow the package instructions. Keep the fridge at 4°C (40°F) or lower and the freezer at −18°C (0°F) or lower.";
}

export function addDaysISO(days, date = new Date()) {
  return todayISO(new Date(date.getFullYear(), date.getMonth(), date.getDate() + Number(days)));
}

export function groupActiveItems(items, now = new Date()) {
  const groups = { expired: [], soon: [], later: [] };
  items.filter((item) => item.status === "active").forEach((item) => groups[expiryState(effectiveExpiryDate(item), now)].push(item));
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
