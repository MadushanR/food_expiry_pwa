import { DEFAULT_GROCERY_ITEMS } from "./grocery-data.js";
import { normalizeFoodTemplate, normalizeGroceryItem, normalizeItem, normalizeShoppingTrip } from "./utils.js";

const DB_NAME = "freshcheck";
const DB_VERSION = 5;
const ITEM_STORE = "items";
const META_STORE = "meta";
const GROCERY_STORE = "groceryItems";
const TEMPLATE_STORE = "foodTemplates";
const TRIP_STORE = "shoppingTrips";

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Database transaction was cancelled."));
  });
}

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ITEM_STORE)) db.createObjectStore(ITEM_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(GROCERY_STORE)) db.createObjectStore(GROCERY_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(TEMPLATE_STORE)) db.createObjectStore(TEMPLATE_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(TRIP_STORE)) db.createObjectStore(TRIP_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function seedGroceryItems(db) {
  const check = db.transaction(META_STORE, "readonly");
  const completed = await requestResult(check.objectStore(META_STORE).get("grocerySeedComplete"));
  if (completed) return 0;
  const transaction = db.transaction([GROCERY_STORE, META_STORE], "readwrite");
  const groceryStore = transaction.objectStore(GROCERY_STORE);
  const existingCount = await requestResult(groceryStore.count());
  let seeded = 0;
  if (existingCount === 0) {
    DEFAULT_GROCERY_ITEMS.forEach((raw, index) => {
      groceryStore.put(normalizeGroceryItem({ ...raw, id: `grocery-default-${index + 1}` }));
      seeded += 1;
    });
  }
  transaction.objectStore(META_STORE).put({ key: "grocerySeedComplete", completedAt: new Date().toISOString() });
  await transactionDone(transaction);
  return seeded;
}

export async function migrateLegacyItems(db) {
  const check = db.transaction(META_STORE, "readonly");
  const completed = await requestResult(check.objectStore(META_STORE).get("legacyMigrationComplete"));
  if (completed) return 0;
  let legacy = [];
  try { legacy = JSON.parse(localStorage.getItem("foodItems") || "[]"); } catch { legacy = []; }
  const transaction = db.transaction([ITEM_STORE, META_STORE], "readwrite");
  const itemStore = transaction.objectStore(ITEM_STORE);
  const existingCount = await requestResult(itemStore.count());
  let migrated = 0;
  if (existingCount === 0 && Array.isArray(legacy)) {
    for (const raw of legacy) {
      const item = normalizeItem(raw);
      if (item.name && item.expiryDate) { itemStore.put(item); migrated += 1; }
    }
  }
  transaction.objectStore(META_STORE).put({ key: "legacyMigrationComplete", completedAt: new Date().toISOString() });
  await transactionDone(transaction);
  return migrated;
}

export async function getItems(db) {
  const items = await requestResult(db.transaction(ITEM_STORE, "readonly").objectStore(ITEM_STORE).getAll());
  return items.map(normalizeItem);
}

export async function saveItem(db, item) {
  const transaction = db.transaction(ITEM_STORE, "readwrite");
  transaction.objectStore(ITEM_STORE).put(normalizeItem(item));
  await transactionDone(transaction);
}

export async function removeItem(db, id) {
  const transaction = db.transaction(ITEM_STORE, "readwrite");
  transaction.objectStore(ITEM_STORE).delete(id);
  await transactionDone(transaction);
}

export async function replaceItems(db, items) {
  const normalized = items.map(normalizeItem);
  const transaction = db.transaction(ITEM_STORE, "readwrite");
  const store = transaction.objectStore(ITEM_STORE);
  store.clear();
  normalized.forEach((item) => store.put(item));
  await transactionDone(transaction);
  return normalized.length;
}

export async function getGroceryItems(db) {
  const items = await requestResult(db.transaction(GROCERY_STORE, "readonly").objectStore(GROCERY_STORE).getAll());
  return items.map(normalizeGroceryItem);
}

export async function saveGroceryItem(db, item) {
  const transaction = db.transaction(GROCERY_STORE, "readwrite");
  transaction.objectStore(GROCERY_STORE).put(normalizeGroceryItem(item));
  await transactionDone(transaction);
}

export async function removeGroceryItem(db, id) {
  const transaction = db.transaction(GROCERY_STORE, "readwrite");
  transaction.objectStore(GROCERY_STORE).delete(id);
  await transactionDone(transaction);
}

export async function replaceGroceryItems(db, items) {
  const normalized = items.map(normalizeGroceryItem);
  const transaction = db.transaction(GROCERY_STORE, "readwrite");
  const store = transaction.objectStore(GROCERY_STORE);
  store.clear();
  normalized.forEach((item) => store.put(item));
  await transactionDone(transaction);
  return normalized.length;
}

export async function getFoodTemplates(db) {
  const templates = await requestResult(db.transaction(TEMPLATE_STORE, "readonly").objectStore(TEMPLATE_STORE).getAll());
  return templates.map(normalizeFoodTemplate);
}

export async function saveFoodTemplate(db, template) {
  const transaction = db.transaction(TEMPLATE_STORE, "readwrite");
  transaction.objectStore(TEMPLATE_STORE).put(normalizeFoodTemplate(template));
  await transactionDone(transaction);
}

export async function removeFoodTemplate(db, id) {
  const transaction = db.transaction(TEMPLATE_STORE, "readwrite");
  transaction.objectStore(TEMPLATE_STORE).delete(id);
  await transactionDone(transaction);
}

export async function replaceFoodTemplates(db, templates) {
  const normalized = templates.map(normalizeFoodTemplate);
  const transaction = db.transaction(TEMPLATE_STORE, "readwrite");
  const store = transaction.objectStore(TEMPLATE_STORE);
  store.clear();
  normalized.forEach((template) => store.put(template));
  await transactionDone(transaction);
  return normalized.length;
}

export async function getShoppingTrips(db) {
  const trips = await requestResult(db.transaction(TRIP_STORE, "readonly").objectStore(TRIP_STORE).getAll());
  return trips.map(normalizeShoppingTrip);
}

export async function saveShoppingTrip(db, trip) {
  const transaction = db.transaction(TRIP_STORE, "readwrite");
  transaction.objectStore(TRIP_STORE).put(normalizeShoppingTrip(trip));
  await transactionDone(transaction);
}

export async function replaceShoppingTrips(db, trips) {
  const normalized = trips.map(normalizeShoppingTrip);
  const transaction = db.transaction(TRIP_STORE, "readwrite");
  const store = transaction.objectStore(TRIP_STORE); store.clear();
  normalized.forEach((trip) => store.put(trip));
  await transactionDone(transaction);
  return normalized.length;
}
