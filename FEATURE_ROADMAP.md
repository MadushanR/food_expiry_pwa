# FreshCheck selected feature roadmap

This file is the hand-off source of truth for the current feature release. Work through the list in order, update a feature to **Complete** only after its acceptance checks and automated tests pass, and commit that update with the implementation.

## Resume instructions

1. Check out `codex/selected-feature-roadmap` and pull its latest commits.
2. Run `npm test` and confirm the working tree is clean.
3. Start with the first feature marked **In progress** or **Pending**.
4. Preserve local-first behavior, iPhone PWA usability, existing backups, and the muted green/brown themes.
5. After each feature: add/update tests, run `npm test`, mark it complete below, and create a focused commit.

## Status

- **In progress — E1: Expiry calendar**
- Completed: 9 / 20
- Last updated: 2026-09-20

## Ordered feature list

- [x] **I10 — Favourite templates** *(Complete — 2026-09-20)*
  - Save an inventory item as a reusable favourite independent of its inventory status.
  - Show favourites before recent foods in the Add Food form.
  - Tapping a favourite fills the reusable product fields; favourites can be removed.
- [x] **G1 — Dedicated Shopping Mode** *(Complete — 2026-09-20)*
  - Provide a focused, large-control shopping view for one selected store.
  - Keep the screen awake when supported and show trip progress.
- [x] **I1 — Partial quantities** *(Complete — 2026-09-20)*
  - Let users consume or waste part of an item without completing the whole record.
  - Record the partial outcome and retain the remaining quantity.
- [x] **I2 — Opened date** *(Complete — 2026-09-20)*
  - Store and edit an optional opened date separately from expiry.
  - Display opened status on active inventory.
- [x] **I3 — After-opening lifetime** *(Complete — 2026-09-20)*
  - Store a reusable number of days after opening.
  - Calculate an effective use-by date without overwriting the printed expiry.
- [x] **I9 — Low-stock levels** *(Complete — 2026-09-20)*
  - Configure an optional minimum quantity per reusable product.
  - Mark the linked grocery as To buy when active stock reaches the threshold.
- [x] **G4 — Low-stock replenishment** *(Complete — 2026-09-20)*
  - Apply low-stock rules automatically after partial use, use, waste, restore, and quantity edits.
  - Explain automatic shopping-list changes to the user.
- [x] **G6 — Suggested quantities** *(Complete — 2026-09-20)*
  - Suggest a shopping quantity from the configured target and current active stock.
  - Keep the suggested quantity editable.
- [x] **G14 — Buy again** *(Complete — 2026-09-20)*
  - Save completed shopping trips and restore all or selected items to To buy.
- [ ] **E1 — Expiry calendar** *(In progress)*
  - Add a weekly/monthly calendar-style view of active expiry dates.
- [ ] **E2 — Use-first score** *(Pending)*
  - Rank active food using expiry, opened status, quantity, and storage.
  - Show a short, understandable reason for the ranking.
- [ ] **E3 — Freeze-by suggestions** *(Pending)*
  - Suggest a freeze-by date for suitable foods while keeping it editable.
- [ ] **E4 — Thaw tracking** *(Pending)*
  - Record when frozen food is returned to active inventory and suggest a new use-by date.
- [ ] **E6 — Storage guidance** *(Pending)*
  - Provide concise, clearly identified guidance for common product categories.
- [ ] **E7 — Use-it-up suggestions** *(Pending)*
  - Suggest practical combinations from foods that need attention soon.
  - Work locally without a paid AI service.
- [ ] **B2 — Nutrition summary** *(Pending)*
  - Save and display available calories, protein, carbohydrates, fat, sugar, sodium, and fibre from barcode lookup.
  - Clearly indicate missing or externally sourced information.
- [ ] **B3 — Nutri-Score** *(Pending)*
  - Save and display an available Nutri-Score without treating it as medical advice.
- [ ] **B8 — Rapid scanning mode** *(Pending)*
  - Scan multiple products in one session without reopening the Add Food dialog.
  - Prevent accidental duplicate scan events.
- [ ] **B10 — Unknown-product form** *(Pending)*
  - Turn a failed barcode lookup into a fast manual product entry while retaining the barcode.
- [ ] **U4 — Swipe actions** *(Pending)*
  - Add accessible swipe shortcuts for common inventory actions on touch devices.
  - Retain visible buttons and keyboard access as non-gesture alternatives.

## Release completion checklist

- [ ] Every selected feature above is complete.
- [ ] Backups include every new persisted field/store and older backups still restore.
- [ ] Offline app-shell caching includes every new local module or asset.
- [ ] Automated tests and syntax checks pass.
- [ ] Phone-sized light and dark layouts are visually checked.
- [ ] The branch is pushed and a pull request is opened with test evidence.
