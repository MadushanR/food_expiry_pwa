import {
  activeProductQuantity, addDaysISO, configuredLowStockThreshold, createOutcomeRecords, daysUntil, effectiveExpiryDate, expiryState, findMatchingFoodTemplate, findMatchingGroceryItem,
  groupActiveItems, hasActiveGroceryMatch, isLowStock, makeId, normalizeFoodTemplate, normalizeGroceryItem, normalizeItem, outcomeCounts,
  parseGS1Barcode, parsePackageQuantity, recentFoodTemplates, relativeExpiry, shoppingProgress, suggestedRestockQuantity, todayISO,
  validateGroceryItem, validateItem
} from "./utils.js";
import {
  getFoodTemplates, getGroceryItems, getItems, migrateLegacyItems, openDatabase, removeFoodTemplate, removeGroceryItem,
  removeItem, replaceFoodTemplates, replaceGroceryItems, replaceItems, saveFoodTemplate, saveGroceryItem, saveItem, seedGroceryItems
} from "./storage.js";

const $ = (selector) => document.querySelector(selector);
const elements = {
  todayGroups: $("#todayGroups"), inventoryGroups: $("#inventoryGroups"), historyList: $("#historyList"),
  search: $("#searchInput"), filter: $("#filterSelect"), sort: $("#sortSelect"), historyFilter: $("#historyFilter"),
  expiredCount: $("#expiredCount"), todayCount: $("#todayCount"), soonCount: $("#soonCount"),
  usedCount: $("#usedCount"), wastedCount: $("#wastedCount"), frozenCount: $("#frozenCount"),
  itemDialog: $("#itemDialog"), itemForm: $("#itemForm"), itemId: $("#itemId"), itemName: $("#itemName"),
  expiryDate: $("#expiryDate"), openedDate: $("#openedDate"), afterOpeningDays: $("#afterOpeningDays"), lowStockThreshold: $("#lowStockThreshold"), targetQuantity: $("#targetQuantity"), quantity: $("#quantity"), unit: $("#unit"), location: $("#location"), notes: $("#notes"),
  barcode: $("#barcode"), brand: $("#brand"), scannerPanel: $("#scannerPanel"), barcodeVideo: $("#barcodeVideo"),
  scannerStatus: $("#scannerStatus"), manualBarcode: $("#manualBarcode"),
  formError: $("#formError"), formTitle: $("#formTitle"), formEyebrow: $("#formEyebrow"),
  favoriteTemplateId: $("#favoriteTemplateId"), saveFavorite: $("#saveFavorite"),
  favoriteFoods: $("#favoriteFoods"), favoriteFoodButtons: $("#favoriteFoodButtons"),
  recentFoods: $("#recentFoods"), recentFoodButtons: $("#recentFoodButtons"),
  outcomeDialog: $("#outcomeDialog"), outcomeTitle: $("#outcomeTitle"), outcomeQuantityField: $("#outcomeQuantityField"),
  outcomeQuantity: $("#outcomeQuantity"), outcomeUnit: $("#outcomeUnit"), outcomeError: $("#outcomeError"),
  groceryList: $("#groceryList"), grocerySearch: $("#grocerySearch"), groceryStoreFilter: $("#groceryStoreFilter"),
  groceryStatusFilter: $("#groceryStatusFilter"), toBuyCount: $("#toBuyCount"),
  walmartNeedCount: $("#walmartNeedCount"), dollaramaNeedCount: $("#dollaramaNeedCount"),
  groceryDialog: $("#groceryDialog"), groceryForm: $("#groceryForm"), groceryItemId: $("#groceryItemId"),
  groceryItemName: $("#groceryItemName"), groceryQuantity: $("#groceryQuantity"), groceryStore: $("#groceryStore"),
  groceryHave: $("#groceryHave"), groceryFormError: $("#groceryFormError"),
  groceryFormTitle: $("#groceryFormTitle"), groceryFormEyebrow: $("#groceryFormEyebrow"),
  shoppingDialog: $("#shoppingDialog"), shoppingStore: $("#shoppingStore"), shoppingList: $("#shoppingList"),
  shoppingProgressText: $("#shoppingProgressText"), shoppingProgressBar: $("#shoppingProgressBar"), shoppingWakeStatus: $("#shoppingWakeStatus"),
  dataDialog: $("#dataDialog"), dataStatus: $("#dataStatus"), themeSelect: $("#themeSelect"),
  toast: $("#toast"), toastMessage: $("#toastMessage"), undoButton: $("#undoButton"),
};

let db;
let items = [];
let groceryItems = [];
let foodTemplates = [];
let undoAction = null;
let actionItemId = null;
let toastTimer = null;
let scannerControls = null;
let barcodeLookupPending = false;
let barcodeLookupController = null;
let shoppingItemIds = [];
let wakeLock = null;

function escapeHTML(value) {
  const node = document.createElement("span");
  node.textContent = String(value ?? "");
  return node.innerHTML;
}

function applyTheme(preference = localStorage.getItem("freshcheckTheme") || "system") {
  if (preference === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = preference;
  localStorage.setItem("freshcheckTheme", preference);
  const dark = preference === "dark" || (preference === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  $("#themeColor").content = dark ? "#181a16" : "#f3f0e7";
  if (elements.themeSelect) elements.themeSelect.value = preference;
}

applyTheme();

function formatDate(value, options = { month: "short", day: "numeric", year: "numeric" }) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, options).format(new Date(year, month - 1, day));
}

function formatCompleted(value) {
  if (!value) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}

function setView(view) {
  document.querySelectorAll("[data-view]").forEach((section) => { section.hidden = section.dataset.view !== view; });
  document.querySelectorAll("[data-nav]").forEach((button) => {
    if (button.dataset.nav === view) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  window.scrollTo({ top: 0, behavior: "auto" });
}

function inventoryItems() {
  const query = elements.search.value.trim().toLowerCase();
  const filter = elements.filter.value;
  return items.filter((item) => {
    if (item.status !== "active") return false;
    if (query && ![item.name, item.location, item.notes].some((value) => value.toLowerCase().includes(query))) return false;
    const days = daysUntil(effectiveExpiryDate(item));
    if (filter === "active") return true;
    if (filter === "expired") return days < 0;
    if (filter === "today") return days === 0;
    if (filter === "soon") return days >= 1 && days <= 3;
    if (filter === "later") return days > 3;
    return item.location === filter;
  }).sort((a, b) => {
    if (elements.sort.value === "name") return a.name.localeCompare(b.name);
    if (elements.sort.value === "recent") return b.createdAt.localeCompare(a.createdAt);
    return effectiveExpiryDate(a).localeCompare(effectiveExpiryDate(b)) || a.name.localeCompare(b.name);
  });
}

function activeItemMarkup(item) {
  const useBy = effectiveExpiryDate(item);
  const adjustedAfterOpening = useBy !== item.expiryDate;
  const relative = relativeExpiry(useBy);
  const relativeLabel = adjustedAfterOpening ? relative.replace(/^Expires/, "Use").replace(/^Expired/, "Use-by passed") : relative;
  const printedExpiry = adjustedAfterOpening ? `<span>Label expiry ${escapeHTML(formatDate(item.expiryDate, { month: "short", day: "numeric" }))}</span>` : "";
  const lowStock = isLowStock(item, items) ? '<span class="low-stock-label">Low stock</span>' : "";
  const state = expiryState(useBy);
  const quantity = item.quantity == null ? "" : `${item.quantity}${item.unit ? ` ${escapeHTML(item.unit)}` : ""}`;
  return `<article class="food-item ${state}" data-id="${escapeHTML(item.id)}">
    <div><p class="food-name">${escapeHTML(item.name)}</p>
      <div class="food-meta"><span class="expiry-label">${escapeHTML(relativeLabel)}</span><span>${adjustedAfterOpening ? "Use by " : ""}${escapeHTML(formatDate(useBy))}</span>${printedExpiry}${item.openedDate ? `<span>Opened ${escapeHTML(formatDate(item.openedDate, { month: "short", day: "numeric" }))}</span>` : ""}<span>${escapeHTML(item.location)}</span>${item.brand ? `<span>${escapeHTML(item.brand)}</span>` : ""}${quantity ? `<span>${quantity}</span>` : ""}${lowStock}</div>
      ${item.notes ? `<p class="food-notes">${escapeHTML(item.notes)}</p>` : ""}
    </div>
    <div class="item-menu"><button class="item-action primary-action" type="button" data-action="act" aria-label="Record an outcome for ${escapeHTML(item.name)}">Act</button><button class="item-action" type="button" data-action="favorite" aria-label="${findMatchingFoodTemplate(item, foodTemplates) ? "Remove" : "Save"} ${escapeHTML(item.name)} ${findMatchingFoodTemplate(item, foodTemplates) ? "from" : "as"} favourites">${findMatchingFoodTemplate(item, foodTemplates) ? "★" : "☆"}</button><button class="item-action" type="button" data-action="edit" aria-label="Edit ${escapeHTML(item.name)}">Edit</button><button class="item-action destructive" type="button" data-action="delete" aria-label="Delete ${escapeHTML(item.name)}">Delete</button></div>
  </article>`;
}

function historyItemMarkup(item) {
  const label = item.status[0].toUpperCase() + item.status.slice(1);
  const quantity = item.quantity == null ? "" : `<span>${escapeHTML(item.quantity)}${item.unit ? ` ${escapeHTML(item.unit)}` : ""}</span>`;
  return `<article class="food-item ${item.status}" data-id="${escapeHTML(item.id)}">
    <div><p class="food-name">${escapeHTML(item.name)}</p><div class="food-meta"><span class="outcome-label">${label}</span><span>${escapeHTML(formatCompleted(item.completedAt))}</span><span>${escapeHTML(item.location)}</span>${quantity}</div></div>
    <div class="item-menu"><button class="item-action primary-action" type="button" data-action="restore" aria-label="Restore ${escapeHTML(item.name)} to inventory">Restore</button><button class="item-action" type="button" data-action="favorite" aria-label="${findMatchingFoodTemplate(item, foodTemplates) ? "Remove" : "Save"} ${escapeHTML(item.name)} ${findMatchingFoodTemplate(item, foodTemplates) ? "from" : "as"} favourites">${findMatchingFoodTemplate(item, foodTemplates) ? "★" : "☆"}</button><button class="item-action destructive" type="button" data-action="delete" aria-label="Delete ${escapeHTML(item.name)} permanently">Delete</button></div>
  </article>`;
}

function groceryItemMarkup(item) {
  const quantity = item.quantity ? ` · ${escapeHTML(item.quantity)}` : item.suggestedQuantity ? ` · Suggested ${escapeHTML(item.suggestedQuantity)}` : "";
  return `<article class="grocery-row ${item.have ? "have" : ""}" data-grocery-id="${escapeHTML(item.id)}">
    <input class="grocery-toggle" type="checkbox" ${item.have ? "checked" : ""} aria-label="${item.have ? "Move" : "Mark"} ${escapeHTML(item.name)} ${item.have ? "to shopping list" : "as already have"}">
    <div><p class="grocery-name">${escapeHTML(item.name)}</p><p class="grocery-meta"><span class="store-label">${escapeHTML(item.store)}</span>${quantity}</p></div>
    <div class="item-menu"><button class="item-action" type="button" data-grocery-action="edit" aria-label="Edit ${escapeHTML(item.name)}">Edit</button><button class="item-action destructive" type="button" data-grocery-action="delete" aria-label="Delete ${escapeHTML(item.name)}">Delete</button></div>
  </article>`;
}

function emptyMarkup(title, message, showAdd = false) {
  return `<div class="empty-state"><strong>${escapeHTML(title)}</strong><span>${escapeHTML(message)}</span>${showAdd ? '<button class="primary-button add-button" type="button">Add food</button>' : ""}</div>`;
}

function renderToday(active) {
  const urgent = active.filter((item) => daysUntil(effectiveExpiryDate(item)) <= 3).sort((a, b) => effectiveExpiryDate(a).localeCompare(effectiveExpiryDate(b)));
  if (!urgent.length) {
    elements.todayGroups.innerHTML = emptyMarkup("Nothing urgent", active.length ? "Everything is more than three days away." : "Add your first food item to start tracking.", !active.length);
    return;
  }
  const groups = {
    expired: urgent.filter((item) => daysUntil(effectiveExpiryDate(item)) < 0),
    today: urgent.filter((item) => daysUntil(effectiveExpiryDate(item)) === 0),
    soon: urgent.filter((item) => daysUntil(effectiveExpiryDate(item)) >= 1),
  };
  const labels = { expired: "Expired", today: "Today", soon: "Next 3 days" };
  elements.todayGroups.innerHTML = Object.keys(groups).filter((key) => groups[key].length).map((key) =>
    `<section class="group"><div class="group-title"><h3>${labels[key]}</h3><span>${groups[key].length} item${groups[key].length === 1 ? "" : "s"}</span></div><div class="item-list">${groups[key].map(activeItemMarkup).join("")}</div></section>`
  ).join("");
}

function renderInventory() {
  const visible = inventoryItems();
  if (!visible.length) {
    const filtered = elements.search.value.trim() || elements.filter.value !== "active";
    elements.inventoryGroups.innerHTML = emptyMarkup(filtered ? "Nothing matches" : "Your kitchen is clear", filtered ? "Try another search or filter." : "Add food to begin your inventory.", !filtered);
    return;
  }
  if (elements.filter.value === "active" && !elements.search.value.trim()) {
    const grouped = groupActiveItems(visible);
    const labels = { expired: "Expired", soon: "Use in the next 3 days", later: "Later" };
    elements.inventoryGroups.innerHTML = ["expired", "soon", "later"].filter((key) => grouped[key].length).map((key) =>
      `<section class="group"><div class="group-title"><h3>${labels[key]}</h3><span>${grouped[key].length} item${grouped[key].length === 1 ? "" : "s"}</span></div><div class="item-list">${grouped[key].map(activeItemMarkup).join("")}</div></section>`
    ).join("");
  } else elements.inventoryGroups.innerHTML = `<div class="item-list">${visible.map(activeItemMarkup).join("")}</div>`;
}

function renderHistory() {
  const counts = outcomeCounts(items);
  elements.usedCount.textContent = counts.used; elements.wastedCount.textContent = counts.wasted; elements.frozenCount.textContent = counts.frozen;
  const filter = elements.historyFilter.value;
  const history = items.filter((item) => item.status !== "active" && (filter === "all" || item.status === filter))
    .sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || ""));
  elements.historyList.innerHTML = history.length
    ? `<div class="item-list">${history.map(historyItemMarkup).join("")}</div>`
    : emptyMarkup("No history yet", filter === "all" ? "Items you use, waste, or freeze will appear here." : `No items marked ${filter}.`);
}

function renderGroceries() {
  const needs = groceryItems.filter((item) => !item.have);
  elements.toBuyCount.textContent = needs.length;
  elements.walmartNeedCount.textContent = needs.filter((item) => item.store === "Walmart").length;
  elements.dollaramaNeedCount.textContent = needs.filter((item) => item.store === "Dollarama").length;
  const query = elements.grocerySearch.value.trim().toLowerCase();
  const store = elements.groceryStoreFilter.value;
  const status = elements.groceryStatusFilter.value;
  const visible = groceryItems.filter((item) => {
    if (query && !item.name.toLowerCase().includes(query)) return false;
    if (store !== "all" && item.store !== store) return false;
    if (status === "need" && item.have) return false;
    if (status === "have" && !item.have) return false;
    return true;
  }).sort((a, b) => a.store.localeCompare(b.store) || Number(a.have) - Number(b.have) || a.name.localeCompare(b.name));
  if (!visible.length) {
    elements.groceryList.innerHTML = emptyMarkup(status === "need" ? "Shopping list complete" : "No grocery items found", status === "need" ? "You already have everything in this view." : "Try another store, status, or search.");
    return;
  }
  const stores = [...new Set(visible.map((item) => item.store))];
  elements.groceryList.innerHTML = stores.map((storeName) => {
    const storeItems = visible.filter((item) => item.store === storeName);
    return `<section class="group"><div class="group-title"><h3>${escapeHTML(storeName)}</h3><span>${storeItems.filter((item) => !item.have).length} to buy</span></div><div class="item-list">${storeItems.map(groceryItemMarkup).join("")}</div></section>`;
  }).join("");
}

function renderShoppingMode() {
  const tripItems = shoppingItemIds.map((id) => groceryItems.find((item) => item.id === id)).filter(Boolean);
  const progress = shoppingProgress(groceryItems, shoppingItemIds);
  elements.shoppingProgressText.textContent = `${progress.bought} of ${progress.total} collected`;
  elements.shoppingProgressBar.style.width = `${progress.total ? (progress.bought / progress.total) * 100 : 0}%`;
  if (!tripItems.length) {
    elements.shoppingList.innerHTML = emptyMarkup("Nothing to buy here", `Your ${elements.shoppingStore.value} list is complete.`);
    return;
  }
  elements.shoppingList.innerHTML = tripItems.map((item) => `<label class="shopping-row ${item.have ? "have" : ""}" data-shopping-id="${escapeHTML(item.id)}"><input class="shopping-toggle" type="checkbox" ${item.have ? "checked" : ""}><span><strong>${escapeHTML(item.name)}</strong><span>${item.quantity ? escapeHTML(item.quantity) : item.suggestedQuantity ? `Suggested ${escapeHTML(item.suggestedQuantity)}` : "Tap when it is in your cart"}</span></span></label>`).join("");
}

function beginStoreTrip(store) {
  elements.shoppingStore.value = store;
  shoppingItemIds = groceryItems.filter((item) => item.store === store && !item.have).map((item) => item.id);
  renderShoppingMode();
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator) || document.visibilityState !== "visible") {
    elements.shoppingWakeStatus.textContent = "Keep FreshCheck visible while shopping"; return;
  }
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    elements.shoppingWakeStatus.textContent = "Screen will stay awake during this trip";
    wakeLock.addEventListener("release", () => { wakeLock = null; });
  } catch { elements.shoppingWakeStatus.textContent = "Keep FreshCheck visible while shopping"; }
}

async function releaseWakeLock() {
  try { await wakeLock?.release(); } catch { /* The browser already released it. */ }
  wakeLock = null;
}

async function openShoppingMode() {
  const filteredStore = elements.groceryStoreFilter.value;
  const store = filteredStore !== "all" ? filteredStore : (["Walmart", "Dollarama", "Other"].find((name) => groceryItems.some((item) => item.store === name && !item.have)) || "Walmart");
  beginStoreTrip(store); elements.shoppingDialog.showModal(); await requestWakeLock();
}

async function closeShoppingMode() {
  await releaseWakeLock(); elements.shoppingDialog.close(); shoppingItemIds = [];
}

function render() {
  const active = items.filter((item) => item.status === "active");
  elements.expiredCount.textContent = active.filter((item) => daysUntil(effectiveExpiryDate(item)) < 0).length;
  elements.todayCount.textContent = active.filter((item) => daysUntil(effectiveExpiryDate(item)) === 0).length;
  elements.soonCount.textContent = active.filter((item) => daysUntil(effectiveExpiryDate(item)) >= 1 && daysUntil(effectiveExpiryDate(item)) <= 3).length;
  renderToday(active); renderInventory(); renderGroceries(); renderHistory();
}

function renderRecentFoods() {
  const recent = recentFoodTemplates(items);
  elements.recentFoods.hidden = !recent.length;
  elements.recentFoodButtons.innerHTML = recent.map((item) => `<button type="button" class="chip" data-recent-id="${escapeHTML(item.id)}">${escapeHTML(item.name)}</button>`).join("");
}

function renderFavouriteFoods() {
  const favourites = [...foodTemplates].sort((a, b) => a.name.localeCompare(b.name));
  elements.favoriteFoods.hidden = !favourites.length;
  elements.favoriteFoodButtons.innerHTML = favourites.map((template) => `<span class="favorite-template"><button type="button" class="chip" data-template-id="${escapeHTML(template.id)}">★ ${escapeHTML(template.name)}</button><button type="button" class="remove-template" data-remove-template-id="${escapeHTML(template.id)}" aria-label="Remove ${escapeHTML(template.name)} from favourites">×</button></span>`).join("");
}

function fillFromTemplate(template) {
  elements.favoriteTemplateId.value = template.id; elements.saveFavorite.checked = true;
  elements.itemName.value = template.name; elements.location.value = template.location;
  elements.quantity.value = template.quantity ?? ""; elements.unit.value = template.unit;
  elements.afterOpeningDays.value = template.afterOpeningDays ?? "";
  elements.lowStockThreshold.value = template.lowStockThreshold ?? "";
  elements.targetQuantity.value = template.targetQuantity ?? "";
  elements.brand.value = template.brand; elements.barcode.value = template.barcode;
}

function openItemDialog(item = null) {
  stopScanner();
  elements.itemForm.reset(); elements.formError.textContent = "";
  elements.itemId.value = item?.id || ""; elements.itemName.value = item?.name || ""; elements.expiryDate.value = item?.expiryDate || todayISO();
  elements.openedDate.value = item?.openedDate || "";
  elements.afterOpeningDays.value = item?.afterOpeningDays ?? "";
  elements.lowStockThreshold.value = item?.lowStockThreshold ?? "";
  elements.targetQuantity.value = item?.targetQuantity ?? "";
  elements.quantity.value = item?.quantity ?? ""; elements.unit.value = item?.unit || ""; elements.location.value = item?.location || "Fridge"; elements.notes.value = item?.notes || "";
  elements.barcode.value = item?.barcode || ""; elements.brand.value = item?.brand || ""; elements.manualBarcode.value = "";
  const favourite = item ? findMatchingFoodTemplate(item, foodTemplates) : null;
  elements.favoriteTemplateId.value = favourite?.id || item?.favoriteTemplateId || ""; elements.saveFavorite.checked = Boolean(favourite);
  elements.formTitle.textContent = item ? "Edit food" : "Add food"; elements.formEyebrow.textContent = item ? "Update item" : "New item";
  renderFavouriteFoods(); if (item) elements.recentFoods.hidden = true; else renderRecentFoods();
  elements.itemDialog.showModal(); requestAnimationFrame(() => elements.itemName.focus());
}

function openGroceryDialog(item = null) {
  elements.groceryForm.reset(); elements.groceryFormError.textContent = "";
  elements.groceryItemId.value = item?.id || ""; elements.groceryItemName.value = item?.name || "";
  elements.groceryQuantity.value = item?.quantity || ""; elements.groceryStore.value = item?.store || "Walmart"; elements.groceryHave.checked = item?.have || false;
  elements.groceryFormTitle.textContent = item ? "Edit grocery" : "Add grocery"; elements.groceryFormEyebrow.textContent = item ? "Update shopping item" : "Shopping item";
  elements.groceryDialog.showModal(); requestAnimationFrame(() => elements.groceryItemName.focus());
}

async function refresh() {
  [items, groceryItems, foodTemplates] = await Promise.all([getItems(db), getGroceryItems(db), getFoodTemplates(db)]);
  render();
}

function showToast(message, undo = null) {
  clearTimeout(toastTimer);
  undoAction = typeof undo === "function" ? undo : undo ? async () => {
    await saveItem(db, undo);
    const nextItems = items.map((entry) => entry.id === undo.id ? undo : entry).concat(items.some((entry) => entry.id === undo.id) ? [] : [undo]);
    await syncGroceryForItem(undo, nextItems);
  } : null;
  elements.toastMessage.textContent = message;
  elements.undoButton.hidden = !undoAction; elements.toast.hidden = false;
  toastTimer = setTimeout(() => { elements.toast.hidden = true; undoAction = null; }, 6500);
}

function stopScanner() {
  scannerControls?.stop?.(); scannerControls = null; barcodeLookupPending = false;
  barcodeLookupController?.abort(); barcodeLookupController = null;
  if (elements.scannerPanel) elements.scannerPanel.hidden = true;
  const stream = elements.barcodeVideo?.srcObject;
  stream?.getTracks?.().forEach((track) => track.stop());
  if (elements.barcodeVideo) elements.barcodeVideo.srcObject = null;
}

function scannerMessage(message) {
  elements.scannerStatus.textContent = message;
}

function fillProductFields(product, parsed, source) {
  const productName = product?.product_name || product?.generic_name || product?.name || "";
  const brand = product?.brands || product?.brand || "";
  const packageSize = product?.unit
    ? { quantity: product.quantity, unit: product.unit }
    : parsePackageQuantity(product?.quantity || "");
  if (productName) elements.itemName.value = productName;
  if (brand) elements.brand.value = brand;
  if (packageSize.quantity != null) elements.quantity.value = packageSize.quantity;
  if (packageSize.unit) elements.unit.value = packageSize.unit;
  if (product?.afterOpeningDays != null) elements.afterOpeningDays.value = product.afterOpeningDays;
  if (product?.lowStockThreshold != null) elements.lowStockThreshold.value = product.lowStockThreshold;
  if (product?.targetQuantity != null) elements.targetQuantity.value = product.targetQuantity;
  elements.barcode.value = parsed.barcode;
  elements.expiryDate.value = parsed.expiryDate || "";
  const dateMessage = parsed.expiryDate
    ? ` The ${parsed.dateType} date was read from the barcode.`
    : " The package expiry is not in this barcode, so please enter it before saving.";
  scannerMessage(`${source}${dateMessage}`);
  stopScannerCameraOnly();
  elements.itemName.focus();
}

function stopScannerCameraOnly() {
  scannerControls?.stop?.(); scannerControls = null;
  const stream = elements.barcodeVideo?.srcObject;
  stream?.getTracks?.().forEach((track) => track.stop());
  if (elements.barcodeVideo) elements.barcodeVideo.srcObject = null;
}

async function lookUpBarcode(raw) {
  if (barcodeLookupPending) return;
  const parsed = parseGS1Barcode(raw);
  if (!parsed.barcode) { scannerMessage("Enter or scan a valid barcode number."); return; }
  barcodeLookupPending = true; stopScannerCameraOnly();
  scannerMessage("Barcode found. Looking up product details…");
  let controller = null;
  try {
    const comparableBarcode = parsed.barcode.replace(/^0+/, "");
    const known = items.find((item) => String(item.barcode || "").replace(/^0+/, "") === comparableBarcode);
    if (known) {
      fillProductFields(known, parsed, "Product details filled from your FreshCheck history.");
      return;
    }
    controller = new AbortController(); barcodeLookupController = controller;
    const timer = setTimeout(() => controller.abort(), 9000);
    let response;
    try {
      response = await fetch(`https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(parsed.barcode)}?fields=code,product_name,generic_name,brands,quantity&product_type=all`, { signal: controller.signal });
    } finally { clearTimeout(timer); }
    if (!response.ok) throw new Error(response.status === 404 ? "not-found" : "lookup-failed");
    const payload = await response.json();
    const product = payload.product;
    if (!product) throw new Error("not-found");
    fillProductFields(product, parsed, "Product details filled from Open Food Facts.");
  } catch (error) {
    if (error.name === "AbortError" && elements.scannerPanel.hidden) return;
    elements.barcode.value = parsed.barcode;
    elements.expiryDate.value = parsed.expiryDate || "";
    const reason = error.message === "not-found"
      ? "This product is not in Open Food Facts yet. Enter its name and expiry manually."
      : "Product lookup is unavailable. The barcode was saved; enter the remaining details manually.";
    scannerMessage(reason);
  } finally {
    barcodeLookupPending = false;
    if (barcodeLookupController === controller) barcodeLookupController = null;
  }
}

async function startScanner() {
  elements.scannerPanel.hidden = false; elements.manualBarcode.value = "";
  if (!navigator.mediaDevices?.getUserMedia || !globalThis.ZXingBrowser) {
    scannerMessage("Camera scanning is unavailable here. Enter the barcode number below instead.");
    elements.manualBarcode.focus(); return;
  }
  scannerMessage("Allow camera access, then hold the barcode inside the frame.");
  try {
    const reader = new globalThis.ZXingBrowser.BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 250 });
    scannerControls = await reader.decodeFromConstraints(
      { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      elements.barcodeVideo,
      (result, _error, controls) => { if (result && !barcodeLookupPending) { controls?.stop?.(); lookUpBarcode(result.getText()); } }
    );
  } catch {
    stopScannerCameraOnly();
    scannerMessage("Camera access was unavailable. Check Safari permission or enter the barcode number below.");
    elements.manualBarcode.focus();
  }
}

async function syncGroceryForItem(item, currentItems = items) {
  const grocery = findMatchingGroceryItem(item, groceryItems);
  if (!grocery) return null;
  const threshold = configuredLowStockThreshold(item, currentItems, foodTemplates);
  const stock = activeProductQuantity(item, currentItems);
  const suggested = suggestedRestockQuantity(item, currentItems, foodTemplates);
  const shouldHave = item.status === "frozen"
    ? true
    : threshold != null
      ? stock > threshold
      : item.status === "active" || hasActiveGroceryMatch(grocery, currentItems, item.id);
  const suggestedQuantity = !shouldHave && suggested > 0 ? `${suggested}${item.unit ? ` ${item.unit}` : ""}` : "";
  const changed = grocery.have !== shouldHave || grocery.suggestedQuantity !== suggestedQuantity;
  if (changed) {
    await saveGroceryItem(db, { ...grocery, have: shouldHave, suggestedQuantity, updatedAt: new Date().toISOString() });
  }
  return { grocery, changed, shouldHave, threshold, stock, suggestedQuantity };
}

function grocerySyncSuffix(sync) {
  if (!sync?.changed) return "";
  if (!sync.shouldHave && sync.threshold != null) return ` · grocery added at ${sync.stock} remaining`;
  return sync.shouldHave ? " · grocery marked Have" : " · added to groceries";
}

function openOutcome(item) {
  actionItemId = item.id; elements.outcomeTitle.textContent = item.name; elements.outcomeError.textContent = "";
  elements.outcomeQuantityField.hidden = item.quantity == null;
  elements.outcomeQuantity.value = item.quantity ?? ""; elements.outcomeQuantity.max = item.quantity ?? "";
  elements.outcomeUnit.textContent = item.unit ? `in ${item.unit}` : "";
  elements.outcomeDialog.showModal();
}

async function handleItemAction(event) {
  const button = event.target.closest("[data-action]"); if (!button) return;
  const item = items.find((entry) => entry.id === button.closest("[data-id]")?.dataset.id); if (!item) return;
  if (button.dataset.action === "edit") { openItemDialog(item); return; }
  if (button.dataset.action === "act") { openOutcome(item); return; }
  if (button.dataset.action === "favorite") {
    const existingTemplate = findMatchingFoodTemplate(item, foodTemplates);
    if (existingTemplate) {
      await removeFoodTemplate(db, existingTemplate.id);
      await saveItem(db, { ...item, favoriteTemplateId: null, updatedAt: new Date().toISOString() });
      await refresh(); showToast(`${item.name} removed from favourites`); return;
    }
    const template = normalizeFoodTemplate({ ...item, id: item.favoriteTemplateId || makeId() });
    await saveFoodTemplate(db, template);
    await saveItem(db, { ...item, favoriteTemplateId: template.id, updatedAt: new Date().toISOString() });
    await refresh(); showToast(`${item.name} saved as a favourite`); return;
  }
  if (button.dataset.action === "delete") {
    await removeItem(db, item.id);
    const nextItems = items.filter((entry) => entry.id !== item.id);
    const sync = configuredLowStockThreshold(item, nextItems, foodTemplates) != null ? await syncGroceryForItem(item, nextItems) : null;
    await refresh(); showToast(`${item.name} deleted${grocerySyncSuffix(sync)}`, item); return;
  }
  if (button.dataset.action === "restore") {
    const previous = { ...item };
    const restored = { ...item, status: "active", completedAt: null, updatedAt: new Date().toISOString() };
    await saveItem(db, restored); const sync = await syncGroceryForItem(restored, items.map((entry) => entry.id === item.id ? restored : entry));
    await refresh(); showToast(`${item.name} restored${grocerySyncSuffix(sync)}`, previous);
  }
}

async function recordOutcome(status) {
  const item = items.find((entry) => entry.id === actionItemId); if (!item) return;
  let outcome;
  try { outcome = createOutcomeRecords(item, status, elements.outcomeQuantityField.hidden ? null : elements.outcomeQuantity.value); }
  catch (error) { elements.outcomeError.textContent = error.message; return; }
  if (outcome.partial) {
    await saveItem(db, outcome.remaining); await saveItem(db, outcome.completed);
    const nextItems = items.map((entry) => entry.id === item.id ? outcome.remaining : entry).concat(outcome.completed);
    const sync = await syncGroceryForItem(outcome.completed, nextItems);
    elements.outcomeDialog.close(); actionItemId = null; await refresh();
    const amount = `${outcome.completed.quantity}${outcome.completed.unit ? ` ${outcome.completed.unit}` : ""}`;
    showToast(`${amount} of ${item.name} marked ${status}${grocerySyncSuffix(sync)}`, async () => {
      await saveItem(db, item); await removeItem(db, outcome.completed.id); await syncGroceryForItem(item, items);
    });
    return;
  }
  const nextItems = items.map((entry) => entry.id === item.id ? outcome.completed : entry);
  await saveItem(db, outcome.completed); const sync = await syncGroceryForItem(outcome.completed, nextItems);
  elements.outcomeDialog.close(); actionItemId = null; await refresh(); showToast(`${item.name} marked ${status}${grocerySyncSuffix(sync)}`, item);
}

async function saveForm(event) {
  event.preventDefault();
  const existing = items.find((item) => item.id === elements.itemId.value);
  const item = normalizeItem({
    ...existing, id: existing?.id || makeId(), name: elements.itemName.value, expiryDate: elements.expiryDate.value,
    openedDate: elements.openedDate.value,
    afterOpeningDays: elements.afterOpeningDays.value,
    lowStockThreshold: elements.lowStockThreshold.value,
    targetQuantity: elements.targetQuantity.value,
    quantity: elements.quantity.value, unit: elements.unit.value, location: elements.location.value, notes: elements.notes.value,
    barcode: elements.barcode.value, brand: elements.brand.value,
    favoriteTemplateId: elements.saveFavorite.checked ? (elements.favoriteTemplateId.value || existing?.favoriteTemplateId || makeId()) : null,
    status: existing?.status || "active", createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  const error = validateItem(item); if (error) { elements.formError.textContent = error; return; }
  const duplicate = items.find((other) => other.id !== item.id && other.status === "active" && other.name.toLowerCase() === item.name.toLowerCase() && other.expiryDate === item.expiryDate);
  if (duplicate && !confirm(`Another ${item.name} with this expiry date already exists. Save it anyway?`)) return;
  const grocery = findMatchingGroceryItem(item, groceryItems);
  if (grocery) item.groceryItemId = grocery.id;
  const previousTemplate = existing ? findMatchingFoodTemplate(existing, foodTemplates) : null;
  if (elements.saveFavorite.checked) {
    await saveFoodTemplate(db, normalizeFoodTemplate({ ...item, id: item.favoriteTemplateId, createdAt: previousTemplate?.createdAt }));
  } else if (previousTemplate) await removeFoodTemplate(db, previousTemplate.id);
  await saveItem(db, item); const sync = await syncGroceryForItem(item, items.map((entry) => entry.id === item.id ? item : entry).concat(existing ? [] : [item]));
  stopScanner(); elements.itemDialog.close(); await refresh();
  showToast(grocery ? `${item.name} saved${grocerySyncSuffix(sync) || " · grocery list checked"}` : (existing ? `${item.name} updated` : `${item.name} added`));
}

async function saveGroceryForm(event) {
  event.preventDefault();
  const existing = groceryItems.find((item) => item.id === elements.groceryItemId.value);
  const item = normalizeGroceryItem({
    ...existing, id: existing?.id || makeId(), name: elements.groceryItemName.value, quantity: elements.groceryQuantity.value,
    suggestedQuantity: existing?.suggestedQuantity || "",
    store: elements.groceryStore.value, have: elements.groceryHave.checked,
    createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  const linkedFood = items.find((food) => food.status === "active" && findMatchingGroceryItem(food, [item]));
  if (linkedFood) {
    const threshold = configuredLowStockThreshold(linkedFood, items, foodTemplates);
    item.have = threshold == null ? true : activeProductQuantity(linkedFood, items) > threshold;
  }
  const error = validateGroceryItem(item); if (error) { elements.groceryFormError.textContent = error; return; }
  const duplicate = groceryItems.find((other) => other.id !== item.id && other.store === item.store && other.name.toLowerCase() === item.name.toLowerCase());
  if (duplicate && !confirm(`${item.name} is already listed for ${item.store}. Save another one?`)) return;
  await saveGroceryItem(db, item); elements.groceryDialog.close(); await refresh(); showToast(existing ? `${item.name} updated` : `${item.name} added to groceries`);
}

async function handleGroceryClick(event) {
  const button = event.target.closest("[data-grocery-action]"); if (!button) return;
  const item = groceryItems.find((entry) => entry.id === button.closest("[data-grocery-id]")?.dataset.groceryId); if (!item) return;
  if (button.dataset.groceryAction === "edit") { openGroceryDialog(item); return; }
  if (button.dataset.groceryAction === "delete" && confirm(`Delete ${item.name} from your reusable grocery list?`)) {
    await removeGroceryItem(db, item.id); await refresh(); showToast(`${item.name} removed from groceries`);
  }
}

async function handleGroceryToggle(event) {
  const checkbox = event.target.closest(".grocery-toggle"); if (!checkbox) return;
  const item = groceryItems.find((entry) => entry.id === checkbox.closest("[data-grocery-id]")?.dataset.groceryId); if (!item) return;
  await saveGroceryItem(db, { ...item, have: checkbox.checked, suggestedQuantity: checkbox.checked ? "" : item.suggestedQuantity, updatedAt: new Date().toISOString() });
  await refresh(); showToast(checkbox.checked ? `${item.name} marked as already have` : `${item.name} added to shopping list`);
}

async function handleShoppingToggle(event) {
  const checkbox = event.target.closest(".shopping-toggle"); if (!checkbox) return;
  const item = groceryItems.find((entry) => entry.id === checkbox.closest("[data-shopping-id]")?.dataset.shoppingId); if (!item) return;
  await saveGroceryItem(db, { ...item, have: checkbox.checked, suggestedQuantity: checkbox.checked ? "" : item.suggestedQuantity, updatedAt: new Date().toISOString() });
  groceryItems = await getGroceryItems(db); renderGroceries(); renderShoppingMode();
}

function downloadBackup() {
  const payload = { app: "FreshCheck", version: 5, exportedAt: new Date().toISOString(), items, groceryItems, foodTemplates };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = `freshcheck-backup-${todayISO()}.json`;
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  elements.dataStatus.textContent = `${items.length} food records, ${groceryItems.length} grocery items, and ${foodTemplates.length} favourites exported.`;
}

async function importBackup(file) {
  try {
    const payload = JSON.parse(await file.text());
    if (payload?.app !== "FreshCheck" || !Array.isArray(payload.items)) throw new Error("This is not a FreshCheck backup file.");
    const normalized = payload.items.map(normalizeItem);
    if (normalized.some((item) => validateItem(item))) throw new Error("The backup contains an invalid food item.");
    const restoredGroceries = Array.isArray(payload.groceryItems) ? payload.groceryItems.map(normalizeGroceryItem) : null;
    const restoredTemplates = Array.isArray(payload.foodTemplates) ? payload.foodTemplates.map(normalizeFoodTemplate) : null;
    if (restoredGroceries?.some((item) => validateGroceryItem(item))) throw new Error("The backup contains an invalid grocery item.");
    const groceryMessage = restoredGroceries ? ` and ${restoredGroceries.length} grocery items` : "";
    if (!confirm(`Replace this device's inventory with ${normalized.length} food records${groceryMessage}?`)) return;
    await replaceItems(db, normalized);
    if (restoredGroceries) await replaceGroceryItems(db, restoredGroceries);
    if (restoredTemplates) await replaceFoodTemplates(db, restoredTemplates);
    await refresh(); elements.dataStatus.textContent = "Backup restored successfully.";
  } catch (error) { elements.dataStatus.textContent = error.message || "The backup could not be restored."; }
}

function bindEvents() {
  document.body.addEventListener("click", (event) => {
    const add = event.target.closest(".add-button"); if (add) { openItemDialog(); return; }
    const nav = event.target.closest("[data-nav]"); if (nav) { setView(nav.dataset.nav); return; }
    const summary = event.target.closest("[data-inventory-filter]");
    if (summary) { elements.filter.value = summary.dataset.inventoryFilter; setView("inventory"); renderInventory(); }
  });
  $("#cancelItemButton").addEventListener("click", () => { stopScanner(); elements.itemDialog.close(); });
  $("#closeItemButton").addEventListener("click", () => { stopScanner(); elements.itemDialog.close(); });
  elements.itemDialog.addEventListener("cancel", stopScanner);
  $("#scanBarcodeButton").addEventListener("click", startScanner);
  $("#stopScannerButton").addEventListener("click", stopScanner);
  $("#lookupBarcodeButton").addEventListener("click", () => lookUpBarcode(elements.manualBarcode.value));
  elements.manualBarcode.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); lookUpBarcode(elements.manualBarcode.value); } });
  elements.itemForm.addEventListener("submit", saveForm);
  [elements.todayGroups, elements.inventoryGroups, elements.historyList].forEach((container) => container.addEventListener("click", handleItemAction));
  [elements.search, elements.filter, elements.sort].forEach((element) => element.addEventListener("input", renderInventory));
  elements.historyFilter.addEventListener("input", renderHistory);
  document.querySelectorAll("[data-days]").forEach((button) => button.addEventListener("click", () => { elements.expiryDate.value = addDaysISO(button.dataset.days); }));
  elements.recentFoodButtons.addEventListener("click", (event) => {
    const button = event.target.closest("[data-recent-id]"); if (!button) return;
    const template = items.find((item) => item.id === button.dataset.recentId); if (!template) return;
    elements.itemName.value = template.name; elements.location.value = template.location; elements.quantity.value = template.quantity ?? ""; elements.unit.value = template.unit;
    elements.afterOpeningDays.value = template.afterOpeningDays ?? "";
    elements.lowStockThreshold.value = template.lowStockThreshold ?? "";
    elements.targetQuantity.value = template.targetQuantity ?? "";
    elements.brand.value = template.brand || ""; elements.barcode.value = template.barcode || "";
  });
  elements.favoriteFoodButtons.addEventListener("click", async (event) => {
    const removeButton = event.target.closest("[data-remove-template-id]");
    if (removeButton) {
      const template = foodTemplates.find((entry) => entry.id === removeButton.dataset.removeTemplateId); if (!template) return;
      await removeFoodTemplate(db, template.id); foodTemplates = await getFoodTemplates(db); renderFavouriteFoods(); showToast(`${template.name} removed from favourites`); return;
    }
    const button = event.target.closest("[data-template-id]"); if (!button) return;
    const template = foodTemplates.find((entry) => entry.id === button.dataset.templateId); if (template) fillFromTemplate(template);
  });
  $("#closeOutcomeButton").addEventListener("click", () => elements.outcomeDialog.close());
  document.querySelectorAll("[data-outcome]").forEach((button) => button.addEventListener("click", () => recordOutcome(button.dataset.outcome)));
  $("#addGroceryButton").addEventListener("click", () => openGroceryDialog());
  $("#startShoppingButton").addEventListener("click", openShoppingMode);
  $("#closeShoppingButton").addEventListener("click", closeShoppingMode);
  $("#finishShoppingButton").addEventListener("click", closeShoppingMode);
  elements.shoppingDialog.addEventListener("cancel", (event) => { event.preventDefault(); closeShoppingMode(); });
  elements.shoppingStore.addEventListener("change", () => beginStoreTrip(elements.shoppingStore.value));
  elements.shoppingList.addEventListener("change", handleShoppingToggle);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && elements.shoppingDialog.open && !wakeLock) requestWakeLock();
  });
  $("#closeGroceryButton").addEventListener("click", () => elements.groceryDialog.close());
  $("#cancelGroceryButton").addEventListener("click", () => elements.groceryDialog.close());
  elements.groceryForm.addEventListener("submit", saveGroceryForm);
  elements.groceryList.addEventListener("click", handleGroceryClick);
  elements.groceryList.addEventListener("change", handleGroceryToggle);
  [elements.grocerySearch, elements.groceryStoreFilter, elements.groceryStatusFilter].forEach((element) => element.addEventListener("input", renderGroceries));
  $("#dataButton").addEventListener("click", () => { elements.dataStatus.textContent = ""; elements.themeSelect.value = localStorage.getItem("freshcheckTheme") || "system"; elements.dataDialog.showModal(); });
  $("#closeDataButton").addEventListener("click", () => elements.dataDialog.close());
  elements.themeSelect.addEventListener("change", () => applyTheme(elements.themeSelect.value));
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if ((localStorage.getItem("freshcheckTheme") || "system") === "system") applyTheme("system");
  });
  $("#exportButton").addEventListener("click", downloadBackup);
  $("#importButton").addEventListener("click", () => $("#importInput").click());
  $("#importInput").addEventListener("change", (event) => event.target.files[0] && importBackup(event.target.files[0]));
  elements.undoButton.addEventListener("click", async () => {
    if (!undoAction) return; const action = undoAction; undoAction = null; await action(); await refresh(); elements.toast.hidden = true;
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.register("./service-worker.js");
  if (registration.waiting) $("#updateBanner").hidden = false;
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    worker?.addEventListener("statechange", () => { if (worker.state === "installed" && navigator.serviceWorker.controller) $("#updateBanner").hidden = false; });
  });
  $("#updateButton").addEventListener("click", () => registration.waiting?.postMessage({ type: "SKIP_WAITING" }));
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (!refreshing) { refreshing = true; location.reload(); } });
}

async function init() {
  try {
    db = await openDatabase();
    const migrated = await migrateLegacyItems(db);
    const seeded = await seedGroceryItems(db);
    $("#todayDate").textContent = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" }).format(new Date());
    bindEvents(); await refresh(); await registerServiceWorker();
    if (migrated) showToast(`${migrated} existing item${migrated === 1 ? "" : "s"} safely upgraded`);
    else if (seeded) showToast(`${seeded} regular grocery items added`);
  } catch (error) {
    elements.todayGroups.innerHTML = emptyMarkup("FreshCheck could not open its local database", error.message || "Try closing and reopening the app.");
  }
}

init();
