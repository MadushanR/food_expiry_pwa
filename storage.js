import { normalizeItem } from "./utils.js";

const DB_NAME = "freshcheck";
const DB_VERSION = 1;
const ITEM_STORE = "items";
const META_STORE = "meta";

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
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
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
  return requestResult(db.transaction(ITEM_STORE, "readonly").objectStore(ITEM_STORE).getAll());
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
