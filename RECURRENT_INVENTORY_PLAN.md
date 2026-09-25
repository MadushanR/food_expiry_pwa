# Recurrent inventory implementation checklist

This file is the hand-off source of truth for recurrent inventory and grocery synchronization. Complete phases in order. Mark a phase complete only after its acceptance checks and automated tests pass.

## Status

- **In progress — Phase 2: grocery setup and inventory linking**
- Completed: 1 / 4
- Last updated: 2026-09-24

## Phase 1 — Data model and stock rules

- [x] Extend grocery normalization with recurrent-product settings and backward-compatible defaults.
- [x] Calculate owned stock from explicitly linked active and frozen inventory batches.
- [x] Derive Have / To buy and target refill quantities from stock, threshold, and Buy now override.
- [x] Validate recurrent settings and unit consistency.
- [x] Cover legacy records, thresholds, frozen/expired stock, and overrides with automated tests.

## Phase 2 — Grocery setup and inventory linking

- [ ] Add Automatically restock, unit, minimum, and target controls to the grocery editor.
- [ ] Guide initial setup by confirming existing matches, adding current stock, or choosing No current stock.
- [ ] Suggest a grocery link during direct inventory entry and require confirmation.
- [ ] Recalculate both grocery products when an inventory item is relinked.
- [ ] Keep recurrence settings when automatic restocking is disabled.

## Phase 3 — Buying and synchronization workflows

- [ ] Show recurrent stock and suggested purchase quantities in Grocery and Shopping Mode.
- [ ] Add a manual Buy now override without allowing a false manual Have state.
- [ ] Open the inventory form when a recurrent product is marked bought.
- [ ] Leave it To buy when entry is cancelled; clear the override and recalculate only after save.
- [ ] Recalculate after add, edit, partial/full use, waste, delete, freeze, thaw, restore, and undo.
- [ ] Warn before deleting a recurrent grocery and unlink inventory without deleting it.

## Phase 4 — Compatibility and release verification

- [ ] Increment the IndexedDB and backup schema versions while restoring older backups.
- [ ] Refresh offline caching, README, and in-app help text.
- [ ] Run all automated and syntax checks.
- [ ] Visually verify phone-sized light and dark layouts and the core recurrent workflow.
- [ ] Push the branch and open a pull request with test evidence.

## Confirmed behavior

- Recurrent grocery records move between Have and To buy; they are not recreated.
- Recurrence is configured per grocery product and inventory is the source of truth.
- Stock at or below the minimum is To buy; default minimum is zero.
- Suggested quantity refills to the target.
- Active and frozen linked batches count; expiry alone does not remove stock.
- Used, wasted, and deleted amounts trigger recalculation.
- Buy now can force To buy early, but Have cannot be manually forced.
- Each recurrent product uses one chosen unit; FreshCheck does not convert units.
