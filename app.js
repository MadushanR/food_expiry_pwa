import {
  addDaysISO, daysUntil, expiryState, groupActiveItems, makeId, normalizeGroceryItem,
  normalizeItem, outcomeCounts, recentFoodTemplates, relativeExpiry, todayISO,
  validateGroceryItem, validateItem
} from "./utils.js";
import {
  getGroceryItems, getItems, migrateLegacyItems, openDatabase, removeGroceryItem,
  removeItem, replaceGroceryItems, replaceItems, saveGroceryItem, saveItem, seedGroceryItems
} from "./storage.js";

const $ = (selector) => document.querySelector(selector);
const elements = {
  todayGroups: $("#todayGroups"), inventoryGroups: $("#inventoryGroups"), historyList: $("#historyList"),
  search: $("#searchInput"), filter: $("#filterSelect"), sort: $("#sortSelect"), historyFilter: $("#historyFilter"),
  expiredCount: $("#expiredCount"), todayCount: $("#todayCount"), soonCount: $("#soonCount"),
  usedCount: $("#usedCount"), wastedCount: $("#wastedCount"), frozenCount: $("#frozenCount"),
  itemDialog: $("#itemDialog"), itemForm: $("#itemForm"), itemId: $("#itemId"), itemName: $("#itemName"),
  expiryDate: $("#expiryDate"), quantity: $("#quantity"), unit: $("#unit"), location: $("#location"), notes: $("#notes"),
  formError: $("#formError"), formTitle: $("#formTitle"), formEyebrow: $("#formEyebrow"),
  recentFoods: $("#recentFoods"), recentFoodButtons: $("#recentFoodButtons"),
  outcomeDialog: $("#outcomeDialog"), outcomeTitle: $("#outcomeTitle"),
  groceryList: $("#groceryList"), grocerySearch: $("#grocerySearch"), groceryStoreFilter: $("#groceryStoreFilter"),
  groceryStatusFilter: $("#groceryStatusFilter"), toBuyCount: $("#toBuyCount"),
  walmartNeedCount: $("#walmartNeedCount"), dollaramaNeedCount: $("#dollaramaNeedCount"),
  groceryDialog: $("#groceryDialog"), groceryForm: $("#groceryForm"), groceryItemId: $("#groceryItemId"),
  groceryItemName: $("#groceryItemName"), groceryQuantity: $("#groceryQuantity"), groceryStore: $("#groceryStore"),
  groceryHave: $("#groceryHave"), groceryFormError: $("#groceryFormError"),
  groceryFormTitle: $("#groceryFormTitle"), groceryFormEyebrow: $("#groceryFormEyebrow"),
  dataDialog: $("#dataDialog"), dataStatus: $("#dataStatus"), themeSelect: $("#themeSelect"),
  toast: $("#toast"), toastMessage: $("#toastMessage"), undoButton: $("#undoButton"),
};

let db;
let items = [];
let groceryItems = [];
let undoItem = null;
let actionItemId = null;
let toastTimer = null;

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
    const days = daysUntil(item.expiryDate);
    if (filter === "active") return true;
    if (filter === "expired") return days < 0;
    if (filter === "today") return days === 0;
    if (filter === "soon") return days >= 1 && days <= 3;
    if (filter === "later") return days > 3;
    return item.location === filter;
  }).sort((a, b) => {
    if (elements.sort.value === "name") return a.name.localeCompare(b.name);
    if (elements.sort.value === "recent") return b.createdAt.localeCompare(a.createdAt);
    return a.expiryDate.localeCompare(b.expiryDate) || a.name.localeCompare(b.name);
  });
}

function activeItemMarkup(item) {
  const state = expiryState(item.expiryDate);
  const quantity = item.quantity == null ? "" : `${item.quantity}${item.unit ? ` ${escapeHTML(item.unit)}` : ""}`;
  return `<article class="food-item ${state}" data-id="${escapeHTML(item.id)}">
    <div><p class="food-name">${escapeHTML(item.name)}</p>
      <div class="food-meta"><span class="expiry-label">${escapeHTML(relativeExpiry(item.expiryDate))}</span><span>${escapeHTML(formatDate(item.expiryDate))}</span><span>${escapeHTML(item.location)}</span>${quantity ? `<span>${quantity}</span>` : ""}</div>
      ${item.notes ? `<p class="food-notes">${escapeHTML(item.notes)}</p>` : ""}
    </div>
    <div class="item-menu"><button class="item-action primary-action" type="button" data-action="act" aria-label="Record an outcome for ${escapeHTML(item.name)}">Act</button><button class="item-action" type="button" data-action="edit" aria-label="Edit ${escapeHTML(item.name)}">Edit</button><button class="item-action destructive" type="button" data-action="delete" aria-label="Delete ${escapeHTML(item.name)}">Delete</button></div>
  </article>`;
}

function historyItemMarkup(item) {
  const label = item.status[0].toUpperCase() + item.status.slice(1);
  return `<article class="food-item ${item.status}" data-id="${escapeHTML(item.id)}">
    <div><p class="food-name">${escapeHTML(item.name)}</p><div class="food-meta"><span class="outcome-label">${label}</span><span>${escapeHTML(formatCompleted(item.completedAt))}</span><span>${escapeHTML(item.location)}</span></div></div>
    <div class="item-menu"><button class="item-action primary-action" type="button" data-action="restore" aria-label="Restore ${escapeHTML(item.name)} to inventory">Restore</button><button class="item-action destructive" type="button" data-action="delete" aria-label="Delete ${escapeHTML(item.name)} permanently">Delete</button></div>
  </article>`;
}

function groceryItemMarkup(item) {
  const quantity = item.quantity ? ` · ${escapeHTML(item.quantity)}` : "";
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
  const urgent = active.filter((item) => daysUntil(item.expiryDate) <= 3).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  if (!urgent.length) {
    elements.todayGroups.innerHTML = emptyMarkup("Nothing urgent", active.length ? "Everything is more than three days away." : "Add your first food item to start tracking.", !active.length);
    return;
  }
  const groups = {
    expired: urgent.filter((item) => daysUntil(item.expiryDate) < 0),
    today: urgent.filter((item) => daysUntil(item.expiryDate) === 0),
    soon: urgent.filter((item) => daysUntil(item.expiryDate) >= 1),
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

function render() {
  const active = items.filter((item) => item.status === "active");
  elements.expiredCount.textContent = active.filter((item) => daysUntil(item.expiryDate) < 0).length;
  elements.todayCount.textContent = active.filter((item) => daysUntil(item.expiryDate) === 0).length;
  elements.soonCount.textContent = active.filter((item) => daysUntil(item.expiryDate) >= 1 && daysUntil(item.expiryDate) <= 3).length;
  renderToday(active); renderInventory(); renderGroceries(); renderHistory();
}

function renderRecentFoods() {
  const recent = recentFoodTemplates(items);
  elements.recentFoods.hidden = !recent.length;
  elements.recentFoodButtons.innerHTML = recent.map((item) => `<button type="button" class="chip" data-recent-id="${escapeHTML(item.id)}">${escapeHTML(item.name)}</button>`).join("");
}

function openItemDialog(item = null) {
  elements.itemForm.reset(); elements.formError.textContent = "";
  elements.itemId.value = item?.id || ""; elements.itemName.value = item?.name || ""; elements.expiryDate.value = item?.expiryDate || todayISO();
  elements.quantity.value = item?.quantity ?? ""; elements.unit.value = item?.unit || ""; elements.location.value = item?.location || "Fridge"; elements.notes.value = item?.notes || "";
  elements.formTitle.textContent = item ? "Edit food" : "Add food"; elements.formEyebrow.textContent = item ? "Update item" : "New item";
  if (item) elements.recentFoods.hidden = true; else renderRecentFoods();
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
  [items, groceryItems] = await Promise.all([getItems(db), getGroceryItems(db)]);
  render();
}

function showToast(message, item = null) {
  clearTimeout(toastTimer); undoItem = item; elements.toastMessage.textContent = message;
  elements.undoButton.hidden = !item; elements.toast.hidden = false;
  toastTimer = setTimeout(() => { elements.toast.hidden = true; undoItem = null; }, 6500);
}

function openOutcome(item) {
  actionItemId = item.id; elements.outcomeTitle.textContent = item.name; elements.outcomeDialog.showModal();
}

async function handleItemAction(event) {
  const button = event.target.closest("[data-action]"); if (!button) return;
  const item = items.find((entry) => entry.id === button.closest("[data-id]")?.dataset.id); if (!item) return;
  if (button.dataset.action === "edit") { openItemDialog(item); return; }
  if (button.dataset.action === "act") { openOutcome(item); return; }
  if (button.dataset.action === "delete") { await removeItem(db, item.id); await refresh(); showToast(`${item.name} deleted`, item); return; }
  if (button.dataset.action === "restore") {
    const previous = { ...item };
    await saveItem(db, { ...item, status: "active", completedAt: null, updatedAt: new Date().toISOString() });
    await refresh(); showToast(`${item.name} restored`, previous);
  }
}

async function recordOutcome(status) {
  const item = items.find((entry) => entry.id === actionItemId); if (!item) return;
  await saveItem(db, { ...item, status, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  elements.outcomeDialog.close(); actionItemId = null; await refresh(); showToast(`${item.name} marked ${status}`, item);
}

async function saveForm(event) {
  event.preventDefault();
  const existing = items.find((item) => item.id === elements.itemId.value);
  const item = normalizeItem({
    ...existing, id: existing?.id || makeId(), name: elements.itemName.value, expiryDate: elements.expiryDate.value,
    quantity: elements.quantity.value, unit: elements.unit.value, location: elements.location.value, notes: elements.notes.value,
    status: existing?.status || "active", createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  const error = validateItem(item); if (error) { elements.formError.textContent = error; return; }
  const duplicate = items.find((other) => other.id !== item.id && other.status === "active" && other.name.toLowerCase() === item.name.toLowerCase() && other.expiryDate === item.expiryDate);
  if (duplicate && !confirm(`Another ${item.name} with this expiry date already exists. Save it anyway?`)) return;
  await saveItem(db, item); elements.itemDialog.close(); await refresh(); showToast(existing ? `${item.name} updated` : `${item.name} added`);
}

async function saveGroceryForm(event) {
  event.preventDefault();
  const existing = groceryItems.find((item) => item.id === elements.groceryItemId.value);
  const item = normalizeGroceryItem({
    ...existing, id: existing?.id || makeId(), name: elements.groceryItemName.value, quantity: elements.groceryQuantity.value,
    store: elements.groceryStore.value, have: elements.groceryHave.checked,
    createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
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
  await saveGroceryItem(db, { ...item, have: checkbox.checked, updatedAt: new Date().toISOString() });
  await refresh(); showToast(checkbox.checked ? `${item.name} marked as already have` : `${item.name} added to shopping list`);
}

function downloadBackup() {
  const payload = { app: "FreshCheck", version: 3, exportedAt: new Date().toISOString(), items, groceryItems };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = `freshcheck-backup-${todayISO()}.json`;
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  elements.dataStatus.textContent = `${items.length} food records and ${groceryItems.length} grocery items exported.`;
}

async function importBackup(file) {
  try {
    const payload = JSON.parse(await file.text());
    if (payload?.app !== "FreshCheck" || !Array.isArray(payload.items)) throw new Error("This is not a FreshCheck backup file.");
    const normalized = payload.items.map(normalizeItem);
    if (normalized.some((item) => validateItem(item))) throw new Error("The backup contains an invalid food item.");
    const restoredGroceries = Array.isArray(payload.groceryItems) ? payload.groceryItems.map(normalizeGroceryItem) : null;
    if (restoredGroceries?.some((item) => validateGroceryItem(item))) throw new Error("The backup contains an invalid grocery item.");
    const groceryMessage = restoredGroceries ? ` and ${restoredGroceries.length} grocery items` : "";
    if (!confirm(`Replace this device's inventory with ${normalized.length} food records${groceryMessage}?`)) return;
    await replaceItems(db, normalized);
    if (restoredGroceries) await replaceGroceryItems(db, restoredGroceries);
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
  $("#cancelItemButton").addEventListener("click", () => elements.itemDialog.close());
  $("#closeItemButton").addEventListener("click", () => elements.itemDialog.close());
  elements.itemForm.addEventListener("submit", saveForm);
  [elements.todayGroups, elements.inventoryGroups, elements.historyList].forEach((container) => container.addEventListener("click", handleItemAction));
  [elements.search, elements.filter, elements.sort].forEach((element) => element.addEventListener("input", renderInventory));
  elements.historyFilter.addEventListener("input", renderHistory);
  document.querySelectorAll("[data-days]").forEach((button) => button.addEventListener("click", () => { elements.expiryDate.value = addDaysISO(button.dataset.days); }));
  elements.recentFoodButtons.addEventListener("click", (event) => {
    const button = event.target.closest("[data-recent-id]"); if (!button) return;
    const template = items.find((item) => item.id === button.dataset.recentId); if (!template) return;
    elements.itemName.value = template.name; elements.location.value = template.location; elements.quantity.value = template.quantity ?? ""; elements.unit.value = template.unit;
  });
  $("#closeOutcomeButton").addEventListener("click", () => elements.outcomeDialog.close());
  document.querySelectorAll("[data-outcome]").forEach((button) => button.addEventListener("click", () => recordOutcome(button.dataset.outcome)));
  $("#addGroceryButton").addEventListener("click", () => openGroceryDialog());
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
    if (!undoItem) return; await saveItem(db, undoItem); await refresh(); elements.toast.hidden = true; undoItem = null;
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
