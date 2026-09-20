import {
  addDaysISO, expiryState, extractOCRDate, groupActiveItems, makeId,
  normalizeItem, relativeExpiry, todayISO, validateItem
} from "./utils.js";
import { getItems, migrateLegacyItems, openDatabase, removeItem, replaceItems, saveItem } from "./storage.js";

const $ = (selector) => document.querySelector(selector);
const elements = {
  groups: $("#inventoryGroups"), search: $("#searchInput"), filter: $("#filterSelect"), sort: $("#sortSelect"),
  expiredCount: $("#expiredCount"), soonCount: $("#soonCount"), totalCount: $("#totalCount"),
  itemDialog: $("#itemDialog"), itemForm: $("#itemForm"), itemId: $("#itemId"), itemName: $("#itemName"),
  expiryDate: $("#expiryDate"), quantity: $("#quantity"), unit: $("#unit"), location: $("#location"),
  notes: $("#notes"), formError: $("#formError"), formTitle: $("#formTitle"), formEyebrow: $("#formEyebrow"),
  dataDialog: $("#dataDialog"), dataStatus: $("#dataStatus"), imageInput: $("#imageInput"),
  ocrStatus: $("#ocrStatus"), toast: $("#toast"), toastMessage: $("#toastMessage"), undoButton: $("#undoButton"),
};

let db;
let items = [];
let undoItem = null;
let toastTimer = null;

function escapeHTML(value) {
  const node = document.createElement("span");
  node.textContent = String(value ?? "");
  return node.innerHTML;
}

function formatDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" })
    .format(new Date(year, month - 1, day));
}

function filteredItems() {
  const query = elements.search.value.trim().toLowerCase();
  const filter = elements.filter.value;
  const result = items.filter((item) => {
    const matchesSearch = !query || [item.name, item.location, item.notes].some((value) => value.toLowerCase().includes(query));
    if (!matchesSearch) return false;
    if (filter === "all") return true;
    if (filter === "used") return item.status === "used";
    if (item.status !== "active") return false;
    if (filter === "active") return true;
    return expiryState(item.expiryDate) === filter;
  });
  return result.sort((a, b) => {
    if (elements.sort.value === "name") return a.name.localeCompare(b.name);
    if (elements.sort.value === "recent") return b.createdAt.localeCompare(a.createdAt);
    return a.expiryDate.localeCompare(b.expiryDate) || a.name.localeCompare(b.name);
  });
}

function itemMarkup(item) {
  const state = item.status === "used" ? "used" : expiryState(item.expiryDate);
  const quantity = item.quantity == null ? "" : `${item.quantity}${item.unit ? ` ${escapeHTML(item.unit)}` : ""}`;
  return `<article class="food-item ${state}" data-id="${escapeHTML(item.id)}">
    <div>
      <p class="food-name">${escapeHTML(item.name)}</p>
      <div class="food-meta">
        <span class="expiry-label">${item.status === "used" ? "Marked used" : escapeHTML(relativeExpiry(item.expiryDate))}</span>
        <span>${escapeHTML(formatDate(item.expiryDate))}</span><span>${escapeHTML(item.location)}</span>
        ${quantity ? `<span>${quantity}</span>` : ""}
      </div>
      ${item.notes ? `<p class="food-notes">${escapeHTML(item.notes)}</p>` : ""}
    </div>
    <div class="item-menu">
      ${item.status === "active"
        ? `<button class="item-action" type="button" data-action="use" aria-label="Mark ${escapeHTML(item.name)} as used">Used</button>`
        : `<button class="item-action" type="button" data-action="restore" aria-label="Restore ${escapeHTML(item.name)}">Restore</button>`}
      <button class="item-action" type="button" data-action="edit" aria-label="Edit ${escapeHTML(item.name)}">Edit</button>
      <button class="item-action destructive" type="button" data-action="delete" aria-label="Delete ${escapeHTML(item.name)}">Delete</button>
    </div>
  </article>`;
}

function render() {
  const active = items.filter((item) => item.status === "active");
  const counts = groupActiveItems(active);
  elements.expiredCount.textContent = counts.expired.length;
  elements.soonCount.textContent = counts.soon.length;
  elements.totalCount.textContent = active.length;
  const visible = filteredItems();
  if (!visible.length) {
    const searching = elements.search.value.trim() || elements.filter.value !== "active";
    elements.groups.innerHTML = `<div class="empty-state"><strong>${searching ? "Nothing matches" : "Your kitchen is clear"}</strong><span>${searching ? "Try another search or filter." : "Add your first food item to start tracking expiry dates."}</span></div>`;
    return;
  }
  if (elements.filter.value === "active" && !elements.search.value.trim()) {
    const grouped = groupActiveItems(visible);
    const labels = { expired: "Expired", soon: "Use in the next 3 days", later: "Later" };
    elements.groups.innerHTML = ["expired", "soon", "later"].filter((key) => grouped[key].length).map((key) =>
      `<section class="group"><div class="group-title"><h3>${labels[key]}</h3><span>${grouped[key].length} item${grouped[key].length === 1 ? "" : "s"}</span></div><div class="item-list">${grouped[key].map(itemMarkup).join("")}</div></section>`
    ).join("");
  } else {
    elements.groups.innerHTML = `<div class="item-list">${visible.map(itemMarkup).join("")}</div>`;
  }
}

function openItemDialog(item = null) {
  elements.itemForm.reset();
  elements.formError.textContent = "";
  elements.ocrStatus.textContent = "";
  elements.itemId.value = item?.id || "";
  elements.itemName.value = item?.name || "";
  elements.expiryDate.value = item?.expiryDate || todayISO();
  elements.quantity.value = item?.quantity ?? "";
  elements.unit.value = item?.unit || "";
  elements.location.value = item?.location || "Fridge";
  elements.notes.value = item?.notes || "";
  elements.formTitle.textContent = item ? "Edit food" : "Add food";
  elements.formEyebrow.textContent = item ? "Update item" : "New item";
  elements.itemDialog.showModal();
  requestAnimationFrame(() => elements.itemName.focus());
}

async function refresh() { items = await getItems(db); render(); }

function showToast(message, item = null) {
  clearTimeout(toastTimer);
  undoItem = item;
  elements.toastMessage.textContent = message;
  elements.undoButton.hidden = !item;
  elements.toast.hidden = false;
  toastTimer = setTimeout(() => { elements.toast.hidden = true; undoItem = null; }, 6500);
}

async function handleItemAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const item = items.find((entry) => entry.id === button.closest("[data-id]")?.dataset.id);
  if (!item) return;
  if (button.dataset.action === "edit") { openItemDialog(item); return; }
  if (button.dataset.action === "delete") {
    await removeItem(db, item.id); await refresh(); showToast(`${item.name} deleted`, item); return;
  }
  const isUsed = button.dataset.action === "use";
  await saveItem(db, { ...item, status: isUsed ? "used" : "active", completedAt: isUsed ? new Date().toISOString() : null, updatedAt: new Date().toISOString() });
  await refresh();
  showToast(isUsed ? `${item.name} marked used` : `${item.name} restored`);
}

async function saveForm(event) {
  event.preventDefault();
  const existing = items.find((item) => item.id === elements.itemId.value);
  const item = normalizeItem({
    ...existing, id: existing?.id || makeId(), name: elements.itemName.value, expiryDate: elements.expiryDate.value,
    quantity: elements.quantity.value, unit: elements.unit.value, location: elements.location.value, notes: elements.notes.value,
    status: existing?.status || "active", createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  const error = validateItem(item);
  if (error) { elements.formError.textContent = error; return; }
  const duplicate = items.find((other) => other.id !== item.id && other.status === "active" && other.name.toLowerCase() === item.name.toLowerCase() && other.expiryDate === item.expiryDate);
  if (duplicate && !confirm(`Another ${item.name} with this expiry date already exists. Save it anyway?`)) return;
  await saveItem(db, item);
  elements.itemDialog.close();
  await refresh();
  showToast(existing ? `${item.name} updated` : `${item.name} added`);
}

function downloadBackup() {
  const payload = { app: "FreshCheck", version: 1, exportedAt: new Date().toISOString(), items };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = `freshcheck-backup-${todayISO()}.json`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  elements.dataStatus.textContent = `${items.length} items exported.`;
}

async function importBackup(file) {
  try {
    const payload = JSON.parse(await file.text());
    if (payload?.app !== "FreshCheck" || !Array.isArray(payload.items)) throw new Error("This is not a FreshCheck backup file.");
    const normalized = payload.items.map(normalizeItem);
    if (normalized.some((item) => validateItem(item))) throw new Error("The backup contains an invalid food item.");
    if (!confirm(`Replace the inventory on this device with ${normalized.length} items from the backup?`)) return;
    await replaceItems(db, normalized); await refresh();
    elements.dataStatus.textContent = `${normalized.length} items restored successfully.`;
  } catch (error) {
    elements.dataStatus.textContent = error.message || "The backup could not be restored.";
  }
}

async function loadTesseract() {
  if (globalThis.Tesseract) return globalThis.Tesseract;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    script.onload = resolve; script.onerror = reject; document.head.appendChild(script);
  });
  return globalThis.Tesseract;
}

async function scanImage(file) {
  elements.ocrStatus.textContent = "Loading scanner…";
  try {
    const Tesseract = await loadTesseract();
    const result = await Tesseract.recognize(file, "eng", { logger: (message) => {
      if (message.status === "recognizing text") elements.ocrStatus.textContent = `Scanning… ${Math.round(message.progress * 100)}%`;
    }});
    const date = extractOCRDate(result.data.text);
    if (!date) throw new Error("No likely date found. Enter it manually.");
    elements.expiryDate.value = date;
    elements.ocrStatus.textContent = `Found ${formatDate(date)} — please verify it.`;
  } catch (error) {
    elements.ocrStatus.textContent = navigator.onLine ? (error.message || "Could not scan this image.") : "Scanning needs an internet connection; enter the date manually.";
  } finally { elements.imageInput.value = ""; }
}

function bindEvents() {
  $("#addButton").addEventListener("click", () => openItemDialog());
  $("#cancelItemButton").addEventListener("click", () => elements.itemDialog.close());
  $("#closeItemButton").addEventListener("click", () => elements.itemDialog.close());
  elements.itemForm.addEventListener("submit", saveForm);
  elements.groups.addEventListener("click", handleItemAction);
  [elements.search, elements.filter, elements.sort].forEach((element) => element.addEventListener("input", render));
  document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => { elements.filter.value = button.dataset.filter; render(); }));
  document.querySelectorAll("[data-days]").forEach((button) => button.addEventListener("click", () => { elements.expiryDate.value = addDaysISO(button.dataset.days); }));
  $("#dataButton").addEventListener("click", () => { elements.dataStatus.textContent = ""; elements.dataDialog.showModal(); });
  $("#closeDataButton").addEventListener("click", () => elements.dataDialog.close());
  $("#exportButton").addEventListener("click", downloadBackup);
  $("#importButton").addEventListener("click", () => $("#importInput").click());
  $("#importInput").addEventListener("change", (event) => event.target.files[0] && importBackup(event.target.files[0]));
  $("#scanButton").addEventListener("click", () => elements.imageInput.click());
  elements.imageInput.addEventListener("change", (event) => event.target.files[0] && scanImage(event.target.files[0]));
  elements.undoButton.addEventListener("click", async () => {
    if (!undoItem) return;
    await saveItem(db, undoItem); await refresh(); elements.toast.hidden = true; undoItem = null;
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.register("./service-worker.js");
  if (registration.waiting) $("#updateBanner").hidden = false;
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) $("#updateBanner").hidden = false;
    });
  });
  $("#updateButton").addEventListener("click", () => registration.waiting?.postMessage({ type: "SKIP_WAITING" }));
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!refreshing) { refreshing = true; location.reload(); }
  });
}

async function init() {
  try {
    db = await openDatabase();
    const migrated = await migrateLegacyItems(db);
    bindEvents(); await refresh(); await registerServiceWorker();
    if (migrated) showToast(`${migrated} existing item${migrated === 1 ? "" : "s"} safely upgraded`);
  } catch (error) {
    elements.groups.innerHTML = `<div class="empty-state"><strong>FreshCheck could not open its local database</strong><span>${escapeHTML(error.message || "Try closing and reopening the app.")}</span></div>`;
  }
}

init();
