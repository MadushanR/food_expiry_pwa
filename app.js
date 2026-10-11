import {
  automaticRestockGrocery, calendarGridDates, daysUntil, effectiveExpiryDate, expiryState,
  groupActiveItems, hasNutrition, makeId, normalizeFoodTemplate, normalizeGroceryItem, normalizeItem,
  normalizeShoppingTrip, nutritionFromOpenFoodFacts, outcomeCounts, parseGS1Barcode, parsePackageQuantity,
  recentFoodTemplates, registerRapidBarcode, relativeExpiry, shoppingProgress, suggestThawUseByDate,
  swipeDirection, todayISO, unknownProductDraft, useFirstPriority, validateGroceryItem, validateItem
} from "./utils.js";
import {
  getFoodTemplates, getGroceryItems, getItems, getShoppingTrips, migrateLegacyItems, openDatabase, removeGroceryItem,
  removeItem, replaceFoodTemplates, replaceGroceryItems, replaceItems, replaceShoppingTrips, saveGroceryItem, saveItem, saveShoppingTrip, seedGroceryItems
} from "./storage.js";

const $ = (selector) => document.querySelector(selector);
const elements = {
  inventoryGroups: $("#inventoryGroups"), historyList: $("#historyList"),
  search: $("#searchInput"), filter: $("#filterSelect"), sort: $("#sortSelect"), historyFilter: $("#historyFilter"),
  usedCount: $("#usedCount"), wastedCount: $("#wastedCount"), frozenCount: $("#frozenCount"),
  itemRestockEnabled: $("#itemRestockEnabled"), itemDialog: $("#itemDialog"), itemForm: $("#itemForm"), itemId: $("#itemId"), itemName: $("#itemName"),
  expiryDate: $("#expiryDate"), quantity: $("#quantity"), unit: $("#unit"), barcode: $("#barcode"), brand: $("#brand"), scannerPanel: $("#scannerPanel"), barcodeVideo: $("#barcodeVideo"),
  scannerStatus: $("#scannerStatus"), manualBarcode: $("#manualBarcode"),
  rapidScanMode: $("#rapidScanMode"), rapidScanCount: $("#rapidScanCount"),
  unknownProductNotice: $("#unknownProductNotice"), unknownProductBarcode: $("#unknownProductBarcode"),
  productDetails: $("#productDetails"), nutritionPreview: $("#nutritionPreview"), nutritionPreviewGrid: $("#nutritionPreviewGrid"),
  formError: $("#formError"), formTitle: $("#formTitle"), formEyebrow: $("#formEyebrow"),
  recentFoods: $("#recentFoods"), recentFoodButtons: $("#recentFoodButtons"),
  outcomeDialog: $("#outcomeDialog"), outcomeTitle: $("#outcomeTitle"), outcomeError: $("#outcomeError"),
  thawDialog: $("#thawDialog"), thawTitle: $("#thawTitle"), thawedDate: $("#thawedDate"), thawUseByDate: $("#thawUseByDate"), thawError: $("#thawError"),
  groceryList: $("#groceryList"), grocerySearch: $("#grocerySearch"), groceryStoreFilter: $("#groceryStoreFilter"),
  groceryStatusFilter: $("#groceryStatusFilter"), toBuyCount: $("#toBuyCount"),
  walmartNeedCount: $("#walmartNeedCount"), dollaramaNeedCount: $("#dollaramaNeedCount"),
  groceryDialog: $("#groceryDialog"), groceryForm: $("#groceryForm"), groceryItemId: $("#groceryItemId"),
  groceryItemName: $("#groceryItemName"), groceryQuantity: $("#groceryQuantity"), groceryStore: $("#groceryStore"),
  groceryHave: $("#groceryHave"), groceryFormError: $("#groceryFormError"),
  groceryFormTitle: $("#groceryFormTitle"), groceryFormEyebrow: $("#groceryFormEyebrow"),
  shoppingDialog: $("#shoppingDialog"), shoppingStore: $("#shoppingStore"), shoppingList: $("#shoppingList"),
  shoppingProgressText: $("#shoppingProgressText"), shoppingProgressBar: $("#shoppingProgressBar"), shoppingWakeStatus: $("#shoppingWakeStatus"),
  recentTripsSection: $("#recentTripsSection"), recentTrips: $("#recentTrips"), buyAgainDialog: $("#buyAgainDialog"),
  buyAgainTitle: $("#buyAgainTitle"), buyAgainList: $("#buyAgainList"),
  calendarDialog: $("#calendarDialog"), calendarTitle: $("#calendarTitle"), calendarMonthLabel: $("#calendarMonthLabel"), calendarGrid: $("#calendarGrid"),
  dataDialog: $("#dataDialog"), dataStatus: $("#dataStatus"), themeSelect: $("#themeSelect"),
  toast: $("#toast"), toastMessage: $("#toastMessage"), undoButton: $("#undoButton"),
};

let db;
let items = [];
let groceryItems = [];
let foodTemplates = [];
let shoppingTrips = [];
let undoAction = null;
let actionItemId = null;
let toastTimer = null;
let scannerControls = null;
let barcodeLookupPending = false;
let barcodeLookupController = null;
let shoppingItemIds = [];
let wakeLock = null;
let selectedTripId = null;
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let pendingNutrition = null;
let rapidScannedBarcodes = new Set();
let swipeStart = null;

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
    if (elements.sort.value === "use-first") return useFirstPriority(b).score - useFirstPriority(a).score || effectiveExpiryDate(a).localeCompare(effectiveExpiryDate(b));
    return effectiveExpiryDate(a).localeCompare(effectiveExpiryDate(b)) || a.name.localeCompare(b.name);
  });
}

function activeItemMarkup(item) {
  const useBy = effectiveExpiryDate(item);
  const nutrition = hasNutrition(item.nutrition) ? nutritionMarkup(item.nutrition) : "";
  return `<article class="food-item ${expiryState(useBy)}" data-id="${escapeHTML(item.id)}">
    <div><p class="food-name">${escapeHTML(item.name)}</p>
      <div class="food-meta"><span class="expiry-label">${escapeHTML(relativeExpiry(useBy))}</span><span>${escapeHTML(formatDate(useBy))}</span>${item.brand ? `<span>${escapeHTML(item.brand)}</span>` : ""}${item.restockEnabled ? '<span class="auto-restock-label">Auto restock</span>' : ""}</div>
      ${nutrition ? `<details class="storage-guidance"><summary>Product information</summary><div class="nutrition-grid">${nutrition}</div></details>` : ""}
    </div>
    <div class="item-menu"><button class="item-action primary-action" type="button" data-action="used">Used</button><button class="item-action" type="button" data-action="act">More</button><button class="item-action" type="button" data-action="edit">Edit</button><button class="item-action destructive" type="button" data-action="delete">Delete</button></div>
  </article>`;
}

function historyItemMarkup(item) {
  const label = item.status[0].toUpperCase() + item.status.slice(1);
  const restoreLabel = item.status === "frozen" ? "Thaw" : "Restore";
  const restoreAction = item.status === "frozen" ? "thaw" : "restore";
  const quantity = item.quantity == null ? "" : `<span>${escapeHTML(item.quantity)}${item.unit ? ` ${escapeHTML(item.unit)}` : ""}</span>`;
  return `<article class="food-item ${item.status}" data-id="${escapeHTML(item.id)}">
    <div><p class="food-name">${escapeHTML(item.name)}</p><div class="food-meta"><span class="outcome-label">${label}</span><span>${escapeHTML(formatCompleted(item.completedAt))}</span><span>${escapeHTML(item.location)}</span>${quantity}</div></div>
    <div class="item-menu"><button class="item-action primary-action" type="button" data-action="${restoreAction}" aria-label="${restoreLabel} ${escapeHTML(item.name)}">${restoreLabel}</button><button class="item-action destructive" type="button" data-action="delete" aria-label="Delete ${escapeHTML(item.name)} permanently">Delete</button></div>
  </article>`;
}

function groceryItemMarkup(item) {
  return `<article class="grocery-row ${item.have ? "have" : ""}" data-grocery-id="${escapeHTML(item.id)}">
    <input class="grocery-toggle" type="checkbox" ${item.have ? "checked" : ""} aria-label="Mark ${escapeHTML(item.name)} as purchased">
    <div><p class="grocery-name">${escapeHTML(item.name)}</p><p class="grocery-meta"><span class="store-label">${escapeHTML(item.store)}</span>${item.quantity ? `<span>${escapeHTML(item.quantity)}</span>` : ""}</p></div>
    <div class="item-menu"><button class="item-action" type="button" data-grocery-action="edit">Edit</button><button class="item-action destructive" type="button" data-grocery-action="delete">Delete</button></div>
  </article>`;
}

function emptyMarkup(title, message, showAdd = false) {
  return `<div class="empty-state"><strong>${escapeHTML(title)}</strong><span>${escapeHTML(message)}</span>${showAdd ? '<button class="primary-button add-button" type="button">Add food</button>' : ""}</div>`;
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

function renderRecentTrips() {
  const recent = [...shoppingTrips].sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, 5);
  elements.recentTripsSection.hidden = !recent.length;
  elements.recentTrips.innerHTML = recent.map((trip) => `<article class="trip-card"><div><strong>${escapeHTML(trip.store)}</strong><p>${escapeHTML(formatCompleted(trip.completedAt))} · ${trip.items.length} item${trip.items.length === 1 ? "" : "s"}</p></div><button class="secondary-button" type="button" data-buy-again-id="${escapeHTML(trip.id)}">Buy again</button></article>`).join("");
}

function renderCalendar() {
  const year = calendarMonth.getFullYear(); const month = calendarMonth.getMonth();
  elements.calendarMonthLabel.textContent = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(calendarMonth);
  elements.calendarGrid.innerHTML = calendarGridDates(year, month).map((date) => {
    const dayItems = items.filter((item) => item.status === "active" && effectiveExpiryDate(item) === date);
    const parsed = date.split("-").map(Number); const outside = parsed[1] - 1 !== month; const today = date === todayISO();
    return `<div class="calendar-day${outside ? " outside" : ""}${today ? " today" : ""}"><span class="calendar-date-number">${parsed[2]}</span>${dayItems.slice(0, 3).map((item) => `<span class="calendar-food ${daysUntil(date) <= 0 ? "urgent" : ""}" title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</span>`).join("")}${dayItems.length > 3 ? `<span class="calendar-food">+${dayItems.length - 3} more</span>` : ""}</div>`;
  }).join("");
}

function openCalendar() {
  calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1); renderCalendar(); elements.calendarDialog.showModal();
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
  elements.shoppingList.innerHTML = tripItems.map((item) => {
    const detail = item.quantity ? escapeHTML(item.quantity) : "Tap when it is in your cart";
    return `<label class="shopping-row ${item.have ? "have" : ""}" data-shopping-id="${escapeHTML(item.id)}"><input class="shopping-toggle" type="checkbox" ${item.have ? "checked" : ""}><span><strong>${escapeHTML(item.name)}</strong><span>${detail}</span></span></label>`;
  }).join("");
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

async function finishShoppingTrip() {
  const collected = shoppingItemIds.map((id) => groceryItems.find((item) => item.id === id)).filter((item) => item?.have);
  if (collected.length) {
    await saveShoppingTrip(db, normalizeShoppingTrip({
      store: elements.shoppingStore.value,
      items: collected.map((item) => ({ groceryItemId: item.id, name: item.name, quantity: item.quantity || item.suggestedQuantity, store: item.store })),
    }));
  }
  await closeShoppingMode(); await refresh();
  showToast(collected.length ? `Trip saved with ${collected.length} collected item${collected.length === 1 ? "" : "s"}` : "Shopping mode closed");
}

function openBuyAgain(trip) {
  selectedTripId = trip.id; elements.buyAgainTitle.textContent = `${trip.store} trip`;
  elements.buyAgainList.innerHTML = trip.items.map((item, index) => `<label class="buy-again-row"><input type="checkbox" data-trip-item-index="${index}" checked><span><strong>${escapeHTML(item.name)}</strong>${item.quantity ? `<span class="helper-text">${escapeHTML(item.quantity)}</span>` : ""}</span></label>`).join("");
  elements.buyAgainDialog.showModal();
}

async function confirmBuyAgain() {
  const trip = shoppingTrips.find((entry) => entry.id === selectedTripId); if (!trip) return;
  const selected = [...elements.buyAgainList.querySelectorAll("[data-trip-item-index]:checked")].map((input) => trip.items[Number(input.dataset.tripItemIndex)]).filter(Boolean);
  for (const tripItem of selected) {
    const existing = groceryItems.find((item) => item.id === tripItem.groceryItemId) || groceryItems.find((item) => item.store === tripItem.store && item.name.toLowerCase() === tripItem.name.toLowerCase());
    await saveGroceryItem(db, normalizeGroceryItem({
      ...existing, id: existing?.id || tripItem.groceryItemId || makeId(), name: tripItem.name,
      quantity: tripItem.quantity || existing?.quantity || "", store: tripItem.store, have: false,
      restockEnabled: false, buyNowOverride: false,
      createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
    }));
  }
  elements.buyAgainDialog.close(); selectedTripId = null; await refresh(); showToast(`${selected.length} item${selected.length === 1 ? "" : "s"} returned to To buy`);
}

function render() {
  renderInventory(); renderGroceries(); renderRecentTrips(); renderHistory();
}

function renderRecentFoods() {
  const recent = recentFoodTemplates(items);
  elements.recentFoods.hidden = !recent.length;
  elements.recentFoodButtons.innerHTML = recent.map((item) => `<button type="button" class="chip" data-recent-id="${escapeHTML(item.id)}">${escapeHTML(item.name)}</button>`).join("");
}


function nutritionMarkup(nutrition) {
  const values = [
    ["Calories", nutrition.energyKcal, "kcal"], ["Protein", nutrition.protein, "g"], ["Carbs", nutrition.carbohydrates, "g"],
    ["Fat", nutrition.fat, "g"], ["Sugar", nutrition.sugar, "g"], ["Sodium", nutrition.sodiumMg, "mg"], ["Fibre", nutrition.fibre, "g"],
  ].filter(([, value]) => value != null);
  const nutrients = values.map(([label, value, unit]) => `<div class="nutrition-value"><strong>${escapeHTML(Number(value).toFixed(Number(value) % 1 ? 1 : 0))} ${unit}</strong><span>${label}</span></div>`).join("");
  const score = nutrition.nutriScore ? `<div class="nutrition-value nutri-score score-${escapeHTML(nutrition.nutriScore.toLowerCase())}"><strong>${escapeHTML(nutrition.nutriScore)}</strong><span>Nutri-Score</span></div>` : "";
  return score + nutrients;
}

function renderNutritionPreview() {
  const visible = hasNutrition(pendingNutrition); elements.nutritionPreview.hidden = !visible;
  elements.nutritionPreviewGrid.innerHTML = visible ? nutritionMarkup(pendingNutrition) : "";
  elements.productDetails.hidden = !visible && !elements.barcode.value && !elements.brand.value && !elements.quantity.value;
}

function openItemDialog(item = null) {
  stopScanner(); elements.itemForm.reset(); elements.formError.textContent = "";
  elements.productDetails.open = false;
  elements.unknownProductNotice.hidden = true;
  elements.itemId.value = item?.id || "";
  elements.itemName.value = item?.name || "";
  elements.expiryDate.value = item?.expiryDate || "";
  elements.itemRestockEnabled.checked = item?.restockEnabled || false;
  elements.barcode.value = item?.barcode || ""; elements.brand.value = item?.brand || "";
  elements.quantity.value = item?.quantity ?? ""; elements.unit.value = item?.unit || "";
  elements.manualBarcode.value = "";
  pendingNutrition = item?.nutrition || null; renderNutritionPreview();
  elements.formTitle.textContent = item ? "Edit food" : "Add food";
  elements.formEyebrow.textContent = item ? "Update item" : "New item";
  if (item) elements.recentFoods.hidden = true; else renderRecentFoods();
  elements.itemDialog.showModal();
}


async function cancelItemEntry() {
  endRapidScanSession(); elements.itemDialog.close();
}


function openGroceryDialog(item = null) {
  elements.groceryForm.reset(); elements.groceryFormError.textContent = "";
  elements.groceryItemId.value = item?.id || ""; elements.groceryItemName.value = item?.name || "";
  elements.groceryQuantity.value = item?.quantity || "";
  elements.groceryStore.value = item?.store || "Choose store";
  elements.groceryHave.checked = item?.have || false;
  elements.groceryFormTitle.textContent = item ? "Edit grocery" : "Add grocery";
  elements.groceryDialog.showModal(); requestAnimationFrame(() => elements.groceryItemName.focus());
}

async function refresh() {
  [items, groceryItems, foodTemplates, shoppingTrips] = await Promise.all([getItems(db), getGroceryItems(db), getFoodTemplates(db), getShoppingTrips(db)]);
  render();
}

function showToast(message, undo = null) {
  clearTimeout(toastTimer);
  undoAction = typeof undo === "function" ? undo : undo ? async () => {
    await saveItem(db, undo);
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

function updateRapidScanCount() {
  const count = rapidScannedBarcodes.size;
  elements.rapidScanCount.textContent = `${count} scanned this session`;
}

function endRapidScanSession() {
  stopScanner();
  rapidScannedBarcodes.clear();
  elements.rapidScanMode.checked = false;
  updateRapidScanCount();
}

function scannerMessage(message) {
  elements.scannerStatus.textContent = message;
}

function fillProductFields(product, parsed, source) {
  elements.unknownProductNotice.hidden = true;
  const productName = product?.product_name || product?.generic_name || product?.name || "";
  const brand = product?.brands || product?.brand || "";
  const packageSize = product?.unit
    ? { quantity: product.quantity, unit: product.unit }
    : parsePackageQuantity(product?.quantity || "");
  if (productName) elements.itemName.value = productName;
  if (brand) elements.brand.value = brand;
  if (packageSize.quantity != null) elements.quantity.value = packageSize.quantity;
  if (packageSize.unit) elements.unit.value = packageSize.unit;
  pendingNutrition = product?.nutrition?.source ? product.nutrition : nutritionFromOpenFoodFacts(product);
  elements.barcode.value = parsed.barcode;
  renderNutritionPreview();
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
  if (elements.rapidScanMode.checked) {
    const registration = registerRapidBarcode(raw, rapidScannedBarcodes);
    if (registration.duplicate) {
      stopScannerCameraOnly();
      scannerMessage("Already scanned in this session. Move this package away, then tap Scan barcode for the next item.");
      return;
    }
    updateRapidScanCount();
  }
  barcodeLookupPending = true; stopScannerCameraOnly();
  elements.itemName.value = ""; elements.brand.value = ""; elements.quantity.value = ""; elements.unit.value = "";
  pendingNutrition = null; elements.barcode.value = parsed.barcode; renderNutritionPreview();
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
      response = await fetch(`https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(parsed.barcode)}?fields=code,product_name,generic_name,brands,quantity,nutriments,nutrition_data_per,nutrition_grades,nutriscore_grade&product_type=all`, { signal: controller.signal });
    } finally { clearTimeout(timer); }
    if (!response.ok) throw new Error(response.status === 404 ? "not-found" : "lookup-failed");
    const payload = await response.json();
    const product = payload.product;
    if (!product) throw new Error("not-found");
    fillProductFields(product, parsed, "Product details filled from Open Food Facts.");
  } catch (error) {
    if (error.name === "AbortError" && elements.scannerPanel.hidden) return;
    const draft = unknownProductDraft(raw);
    elements.barcode.value = draft.barcode;
    elements.expiryDate.value = draft.expiryDate;
    const reason = error.message === "not-found"
      ? "This product is not in Open Food Facts yet."
      : "Product lookup is unavailable right now.";
    scannerMessage(reason);
    stopScannerCameraOnly();
    elements.scannerPanel.hidden = true;
    elements.unknownProductBarcode.textContent = draft.barcode;
    elements.unknownProductNotice.hidden = false;
    elements.itemName.focus();
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
      (result) => { if (result && !barcodeLookupPending) lookUpBarcode(result.getText()); }
    );
  } catch {
    stopScannerCameraOnly();
    scannerMessage("Camera access was unavailable. Check Safari permission or enter the barcode number below.");
    elements.manualBarcode.focus();
  }
}

function openOutcome(item) {
  actionItemId = item.id; elements.outcomeTitle.textContent = item.name;
  elements.outcomeError.textContent = ""; elements.outcomeDialog.showModal();
}

function openThaw(item) {
  actionItemId = item.id; elements.thawTitle.textContent = `Thaw ${item.name}`; elements.thawError.textContent = "";
  elements.thawedDate.value = todayISO(); elements.thawUseByDate.value = suggestThawUseByDate(item, elements.thawedDate.value);
  elements.thawDialog.showModal();
}

async function confirmThaw() {
  const item = items.find((entry) => entry.id === actionItemId); if (!item) return;
  if (!elements.thawedDate.value || !elements.thawUseByDate.value) { elements.thawError.textContent = "Choose both thawed and use-by dates."; return; }
  const thawed = normalizeItem({ ...item, status: "active", location: "Fridge", thawedDate: elements.thawedDate.value,
    originalExpiryDate: item.originalExpiryDate || item.expiryDate, expiryDate: elements.thawUseByDate.value,
    freezeByDate: "", completedAt: null, updatedAt: new Date().toISOString() });
  const error = validateItem(thawed); if (error) { elements.thawError.textContent = error; return; }
  await saveItem(db, thawed);
  elements.thawDialog.close(); actionItemId = null; await refresh(); showToast(`${item.name} returned to the fridge`, item);
}

async function handleItemAction(event) {
  const button = event.target.closest("[data-action]"); if (!button) return;
  const item = items.find((entry) => entry.id === button.closest("[data-id]")?.dataset.id); if (!item) return;
  if (button.dataset.action === "edit") { openItemDialog(item); return; }
  if (button.dataset.action === "used") { actionItemId = item.id; await recordOutcome("used"); return; }
  if (button.dataset.action === "act") { openOutcome(item); return; }
  if (button.dataset.action === "thaw") { openThaw(item); return; }
  if (button.dataset.action === "delete") {
    await removeItem(db, item.id);
    await refresh(); showToast(`${item.name} deleted`, item); return;
  }
  if (button.dataset.action === "restore") {
    const previous = { ...item };
    const restored = { ...item, status: "active", completedAt: null, updatedAt: new Date().toISOString() };
    await saveItem(db, restored);
    await refresh(); showToast(`${item.name} restored`, previous);
  }
}

async function recordOutcome(status) {
  const item = items.find((entry) => entry.id === actionItemId); if (!item) return;
  const completed = normalizeItem({ ...item, status, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const restock = automaticRestockGrocery(completed, groceryItems);
  const previousGrocery = restock ? groceryItems.find((entry) => entry.id === restock.id) : null;
  await saveItem(db, completed);
  if (restock) await saveGroceryItem(db, restock);
  elements.outcomeDialog.close(); actionItemId = null; await refresh();
  showToast(`${item.name} marked ${status}${restock ? " · added to groceries" : ""}`, async () => {
    await saveItem(db, item);
    if (restock) {
      if (previousGrocery) await saveGroceryItem(db, previousGrocery);
      else await removeGroceryItem(db, restock.id);
    }
  });
}

async function saveForm(event) {
  event.preventDefault();
  const existing = items.find((item) => item.id === elements.itemId.value);
  const continueRapidScan = elements.rapidScanMode.checked && !existing;
  const item = normalizeItem({
    ...existing, id: existing?.id || makeId(), name: elements.itemName.value, expiryDate: elements.expiryDate.value,
    nutrition: pendingNutrition, quantity: elements.quantity.value, unit: elements.unit.value,
    barcode: elements.barcode.value, brand: elements.brand.value, restockEnabled: elements.itemRestockEnabled.checked,
    lowStockThreshold: null, targetQuantity: null, groceryItemId: null,
    status: existing?.status || "active", createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  const error = validateItem(item); if (error) { elements.formError.textContent = error; return; }
  const duplicate = items.find((other) => other.id !== item.id && other.status === "active" && other.name.toLowerCase() === item.name.toLowerCase() && other.expiryDate === item.expiryDate);
  if (duplicate && !confirm(`Another ${item.name} with this expiry date already exists. Save it anyway?`)) return;
  await saveItem(db, item); stopScanner(); elements.itemDialog.close(); await refresh();
  showToast(existing ? `${item.name} updated` : `${item.name} added`);
  if (continueRapidScan) {
    openItemDialog(); elements.rapidScanMode.checked = true; updateRapidScanCount(); await startScanner();
  }
}

async function saveGroceryForm(event) {
  event.preventDefault();
  const existing = groceryItems.find((item) => item.id === elements.groceryItemId.value);
  const item = normalizeGroceryItem({ ...existing, id: existing?.id || makeId(), name: elements.groceryItemName.value,
    quantity: elements.groceryQuantity.value, store: elements.groceryStore.value, have: elements.groceryHave.checked,
    restockEnabled: false, suggestedQuantity: "", updatedAt: new Date().toISOString() });
  const error = validateGroceryItem(item); if (error) { elements.groceryFormError.textContent = error; return; }
  await saveGroceryItem(db, item); elements.groceryDialog.close(); await refresh();
  showToast(existing ? `${item.name} updated` : `${item.name} added to groceries`);
}

async function handleGroceryClick(event) {
  const button = event.target.closest("[data-grocery-action]"); if (!button) return;
  const item = groceryItems.find((entry) => entry.id === button.closest("[data-grocery-id]")?.dataset.groceryId); if (!item) return;
  if (button.dataset.groceryAction === "edit") { openGroceryDialog(item); return; }
  if (button.dataset.groceryAction === "delete") {
    if (!confirm(`Delete ${item.name} from groceries?`)) return;
    await removeGroceryItem(db, item.id); await refresh(); showToast(`${item.name} removed from groceries`);
  }
}

async function handleGroceryToggle(event) {
  const checkbox = event.target.closest(".grocery-toggle"); if (!checkbox) return;
  const item = groceryItems.find((entry) => entry.id === checkbox.closest("[data-grocery-id]")?.dataset.groceryId); if (!item) return;
  await saveGroceryItem(db, { ...item, have: checkbox.checked, updatedAt: new Date().toISOString() });
  await refresh(); showToast(checkbox.checked ? `${item.name} marked as already have` : `${item.name} added to shopping list`);
}

function handleSwipeStart(event) {
  if (event.pointerType !== "touch" || event.target.closest("button, a, input, select, textarea, summary")) return;
  const card = event.target.closest(".food-item[data-id]");
  if (!card) return;
  card.setPointerCapture?.(event.pointerId);
  swipeStart = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, id: card.dataset.id, card };
}

function handleSwipeEnd(event) {
  if (!swipeStart || event.pointerId !== swipeStart.pointerId) return;
  const gesture = swipeDirection(swipeStart.x, swipeStart.y, event.clientX, event.clientY);
  const { id, card } = swipeStart; swipeStart = null;
  if (!gesture) return;
  const item = items.find((entry) => entry.id === id);
  if (!item) return;
  card.classList.add(`swiped-${gesture}`);
  setTimeout(() => card.classList.remove(`swiped-${gesture}`), 180);
  if (item.status === "active") {
    if (gesture === "left") openOutcome(item);
    else openItemDialog(item);
  } else if (gesture === "left") {
    if (item.status === "frozen") openThaw(item);
    else handleItemAction({ target: card.querySelector('[data-action="restore"]') });
  }
}

async function handleShoppingToggle(event) {
  const checkbox = event.target.closest(".shopping-toggle"); if (!checkbox) return;
  const item = groceryItems.find((entry) => entry.id === checkbox.closest("[data-shopping-id]")?.dataset.shoppingId); if (!item) return;
  await saveGroceryItem(db, { ...item, have: checkbox.checked, updatedAt: new Date().toISOString() });
  groceryItems = await getGroceryItems(db); renderGroceries(); renderShoppingMode();
}


function downloadBackup() {
  const payload = { app: "FreshCheck", version: 7, exportedAt: new Date().toISOString(), items, groceryItems, foodTemplates, shoppingTrips };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = `freshcheck-backup-${todayISO()}.json`;
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  elements.dataStatus.textContent = `${items.length} food records, ${groceryItems.length} grocery items, ${foodTemplates.length} favourites, and ${shoppingTrips.length} trips exported.`;
}

async function importBackup(file) {
  try {
    const payload = JSON.parse(await file.text());
    if (payload?.app !== "FreshCheck" || !Array.isArray(payload.items)) throw new Error("This is not a FreshCheck backup file.");
    const normalized = payload.items.map(normalizeItem);
    if (normalized.some((item) => validateItem(item))) throw new Error("The backup contains an invalid food item.");
    const restoredGroceries = Array.isArray(payload.groceryItems) ? payload.groceryItems.map(normalizeGroceryItem) : null;
    const restoredTemplates = Array.isArray(payload.foodTemplates) ? payload.foodTemplates.map(normalizeFoodTemplate) : null;
    const restoredTrips = Array.isArray(payload.shoppingTrips) ? payload.shoppingTrips.map(normalizeShoppingTrip) : null;
    if (restoredGroceries?.some((item) => validateGroceryItem(item))) throw new Error("The backup contains an invalid grocery item.");
    const groceryMessage = restoredGroceries ? ` and ${restoredGroceries.length} grocery items` : "";
    if (!confirm(`Replace this device's inventory with ${normalized.length} food records${groceryMessage}?`)) return;
    await replaceItems(db, normalized);
    if (restoredGroceries) await replaceGroceryItems(db, restoredGroceries);
    if (restoredTemplates) await replaceFoodTemplates(db, restoredTemplates);
    if (restoredTrips) await replaceShoppingTrips(db, restoredTrips);
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
  $("#cancelItemButton").addEventListener("click", cancelItemEntry);
  $("#closeItemButton").addEventListener("click", cancelItemEntry);
  elements.itemDialog.addEventListener("cancel", (event) => { event.preventDefault(); cancelItemEntry(); });
  $("#scanBarcodeButton").addEventListener("click", startScanner);
  $("#stopScannerButton").addEventListener("click", stopScanner);
  $("#lookupBarcodeButton").addEventListener("click", () => lookUpBarcode(elements.manualBarcode.value));
  elements.manualBarcode.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); lookUpBarcode(elements.manualBarcode.value); } });
  elements.rapidScanMode.addEventListener("change", () => {
    if (!elements.rapidScanMode.checked) rapidScannedBarcodes.clear();
    updateRapidScanCount();
  });
  $("#unknownProductContinue").addEventListener("click", () => elements.itemName.focus());
  elements.itemForm.addEventListener("submit", saveForm);
  [elements.inventoryGroups, elements.historyList].forEach((container) => container.addEventListener("click", handleItemAction));
  [elements.inventoryGroups, elements.historyList].forEach((container) => {
    container.addEventListener("pointerdown", handleSwipeStart);
    container.addEventListener("pointerup", handleSwipeEnd);
    container.addEventListener("pointercancel", () => { swipeStart = null; });
  });
  [elements.search, elements.filter, elements.sort].forEach((element) => element.addEventListener("input", renderInventory));
  elements.historyFilter.addEventListener("input", renderHistory);
  elements.recentFoodButtons.addEventListener("click", (event) => {
    const button = event.target.closest("[data-recent-id]"); if (!button) return;
    const template = items.find((item) => item.id === button.dataset.recentId); if (!template) return;
    elements.itemName.value = template.name; elements.quantity.value = template.quantity ?? ""; elements.unit.value = template.unit;
    elements.itemRestockEnabled.checked = template.restockEnabled;
    elements.brand.value = template.brand || ""; elements.barcode.value = template.barcode || "";
    pendingNutrition = template.nutrition || null; renderNutritionPreview();
  });
  $("#closeOutcomeButton").addEventListener("click", () => elements.outcomeDialog.close());
  $("#closeThawButton").addEventListener("click", () => elements.thawDialog.close());
  $("#cancelThawButton").addEventListener("click", () => elements.thawDialog.close());
  $("#confirmThawButton").addEventListener("click", confirmThaw);
  elements.thawedDate.addEventListener("change", () => {
    const item = items.find((entry) => entry.id === actionItemId); if (item) elements.thawUseByDate.value = suggestThawUseByDate(item, elements.thawedDate.value);
  });
  document.querySelectorAll("[data-outcome]").forEach((button) => button.addEventListener("click", () => recordOutcome(button.dataset.outcome)));
  $("#addGroceryButton").addEventListener("click", () => openGroceryDialog());
  $("#calendarButton").addEventListener("click", openCalendar);
  $("#closeCalendarButton").addEventListener("click", () => elements.calendarDialog.close());
  $("#previousMonthButton").addEventListener("click", () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1); renderCalendar(); });
  $("#nextMonthButton").addEventListener("click", () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1); renderCalendar(); });
  $("#startShoppingButton").addEventListener("click", openShoppingMode);
  $("#closeShoppingButton").addEventListener("click", closeShoppingMode);
  $("#finishShoppingButton").addEventListener("click", finishShoppingTrip);
  elements.shoppingDialog.addEventListener("cancel", (event) => { event.preventDefault(); closeShoppingMode(); });
  elements.shoppingStore.addEventListener("change", () => beginStoreTrip(elements.shoppingStore.value));
  elements.shoppingList.addEventListener("change", handleShoppingToggle);
  elements.recentTrips.addEventListener("click", (event) => {
    const button = event.target.closest("[data-buy-again-id]"); if (!button) return;
    const trip = shoppingTrips.find((entry) => entry.id === button.dataset.buyAgainId); if (trip) openBuyAgain(trip);
  });
  $("#closeBuyAgainButton").addEventListener("click", () => elements.buyAgainDialog.close());
  $("#cancelBuyAgainButton").addEventListener("click", () => elements.buyAgainDialog.close());
  $("#confirmBuyAgainButton").addEventListener("click", confirmBuyAgain);
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
    bindEvents(); setView("inventory");
    await registerServiceWorker(); await refresh();
    if (migrated) showToast(`${migrated} existing item${migrated === 1 ? "" : "s"} safely upgraded`);
    else if (seeded) showToast(`${seeded} regular grocery items added`);
  } catch (error) {
    if (!elements.inventoryGroups.innerHTML) {
      elements.inventoryGroups.innerHTML = emptyMarkup(db ? "FreshCheck could not load this view" : "FreshCheck could not open its local database", error.message || "Try closing and reopening the app.");
    } else showToast(error.message || "A view could not load. Try closing and reopening the app.");
  }
}

init();
