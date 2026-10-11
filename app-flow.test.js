import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as utils from "./utils.js";

function appHarness() {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const source = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const importedUtilities = source.match(/import \{([\s\S]*?)\} from "\.\/utils\.js";/)[1]
    .split(',').map(name => name.trim()).filter(Boolean);
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
  const nodes = new Map();
  const events = new Map();
  function node(id) {
    assert.ok(ids.has(id), `Missing element ${id}`);
    if (!nodes.has(id)) nodes.set(id, {
      value: (() => {
        const select = html.match(new RegExp(`<select id="${id}">([\\s\\S]*?)</select>`));
        const firstOption = select?.[1].match(/<option(?: value="([^"]*)")?>([^<]*)<\/option>/);
        return firstOption ? firstOption[1] ?? firstOption[2] : '';
      })(), checked: false, hidden: false, innerHTML: '', textContent: '', style: {},
      addEventListener(type, handler) { events.set(`${id}:${type}`, handler); },
      showModal() { this.open = true; }, close() { this.open = false; },
      reset() {}, focus() {},
    });
    return nodes.get(id);
  }
  const foods = new Map(); const groceries = new Map();
  const context = vm.createContext({
    ...Object.fromEntries(importedUtilities.map(name => [name, utils[name]])), console,
    document: {
      documentElement: { removeAttribute() {}, dataset: {} },
      querySelector: (selector) => node(selector.slice(1)),
      querySelectorAll: () => [], body: { addEventListener() {} }, addEventListener() {},
      createElement: () => ({ set textContent(value) { this.innerHTML = String(value); } }),
    },
    localStorage: { getItem() { return null; }, setItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    window: { scrollTo() {} }, navigator: {}, requestAnimationFrame: (fn) => fn(),
    setTimeout: () => 1, clearTimeout() {}, confirm: () => true,
    getItems: async () => [...foods.values()], getGroceryItems: async () => [...groceries.values()],
    getFoodTemplates: async () => [], getShoppingTrips: async () => [],
    saveItem: async (_, item) => foods.set(item.id, item),
    saveGroceryItem: async (_, item) => groceries.set(item.id, item),
    removeItem: async (_, id) => foods.delete(id), removeGroceryItem: async (_, id) => groceries.delete(id),
  });
  const executableSource = source
    .replace(/import \{[\s\S]*?\} from "\.\/(?:utils|storage)\.js";/g, '')
    .replace(/\ninit\(\);\s*$/, '');
  vm.runInContext(executableSource, context);
  vm.runInContext('bindEvents()', context);
  return { foods, groceries, node, events, run: (code) => vm.runInContext(code, context) };
}

test('simple item entry, Used, store assignment, and Undo work together', async () => {
  const app = appHarness();
  app.run('openItemDialog()');
  assert.equal(app.node('expiryDate').value, '');
  app.node('itemName').value = 'Milk'; app.node('expiryDate').value = '2026-10-25';
  app.node('itemRestockEnabled').checked = true;
  await app.run('saveForm({ preventDefault() {} })');
  const item = [...app.foods.values()][0];
  assert.equal(item.restockEnabled, true);
  assert.equal(app.groceries.size, 0);
  await app.run('actionItemId = items[0].id; recordOutcome("used")');
  assert.equal(app.foods.get(item.id).status, 'used');
  const grocery = [...app.groceries.values()][0];
  assert.equal(grocery.store, 'Choose store'); assert.equal(grocery.have, false);
  await app.events.get('undoButton:click')();
  assert.equal(app.foods.get(item.id).status, 'active'); assert.equal(app.groceries.size, 0);
  app.groceries.set('milk-grocery', utils.normalizeGroceryItem({ id: 'milk-grocery', name: 'Milk', store: 'Dollarama', have: true }));
  await app.run('refresh();');
  await app.run('actionItemId = items[0].id; recordOutcome("used")');
  assert.equal(app.groceries.size, 1);
  assert.equal(app.groceries.get('milk-grocery').store, 'Dollarama');
  assert.equal(app.groceries.get('milk-grocery').have, false);
  await app.events.get('undoButton:click')();
  assert.equal(app.groceries.get('milk-grocery').have, true);
});

test('wasted, frozen, and unchecked Used items never trigger restock', async () => {
  for (const [status, restockEnabled] of [['wasted', true], ['frozen', true], ['used', false]]) {
    const app = appHarness();
    app.foods.set('food', utils.normalizeItem({ id: 'food', name: 'Bread', expiryDate: '2026-10-25', restockEnabled }));
    await app.run('refresh()');
    await app.run(`actionItemId = "food"; recordOutcome("${status}")`);
    assert.equal(app.groceries.size, 0);
  }
});

test('grocery checkbox remains manual across refresh and history restore saves food', async () => {
  const app = appHarness();
  app.groceries.set('g', utils.normalizeGroceryItem({ id: 'g', name: 'Eggs', restockEnabled: true, have: true }));
  app.foods.set('food', utils.normalizeItem({ id: 'food', name: 'Eggs', status: 'used', expiryDate: '2026-10-25' }));
  await app.run('refresh()');
  assert.equal(app.groceries.get('g').have, true);
  await app.run('handleItemAction({ target: { closest() { return { dataset: { action: "restore" }, closest() { return { dataset: { id: "food" } }; } }; } } })');
  assert.equal(app.foods.get('food').status, 'active');
});

test('navigation and add form expose the simplified controls', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /data-nav="today"|id="todayView"|id="groceryLink"|id="lowStockThreshold"|id="groceryRestockThreshold"/);
  assert.match(html, /data-nav="inventory" aria-current="page"/);
  appHarness();
});

test('existing inventory and history render without changing saved records', async () => {
  const app = appHarness();
  const records = [
    utils.normalizeItem({ id: 'active', name: 'Saved milk', expiryDate: '2026-11-01' }),
    ...['used', 'wasted', 'frozen'].map(status => utils.normalizeItem({
      id: status, name: `Saved ${status} food`, expiryDate: '2026-11-01', status,
      completedAt: '2026-10-10T12:00:00.000Z',
    })),
  ];
  for (const record of records) app.foods.set(record.id, record);
  await app.run('refresh()');
  assert.match(app.node('inventoryGroups').innerHTML, /Saved milk/);
  for (const status of ['used', 'wasted', 'frozen']) {
    assert.match(app.node('historyList').innerHTML, new RegExp(`Saved ${status} food`));
  }
  assert.doesNotMatch(app.node('historyList').innerHTML, /data-action="favorite"/);
  assert.deepEqual([...app.foods.values()], records);
});
