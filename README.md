# FreshCheck

FreshCheck is a private, local-first Progressive Web App for tracking food expiry dates. It is designed to work as an installed iPhone Home Screen app without a paid backend.

## Features

- Groups active food into Expired, Use soon, and Later
- Opens on a focused Today view for expired, due-today, and next-three-day items
- Stores inventory in IndexedDB and migrates the original `localStorage` records automatically
- Add food manually or scan UPC, EAN, QR, and GS1 barcodes with the device camera
- Fill product name, brand, and package size from Open Food Facts; GS1 dates are filled when present
- Add and edit names, dates, quantities, units, locations, brands, barcodes, and notes
- Save favourite food templates and scan several packages in one rapid-entry session
- Keep an unknown barcode when online product lookup fails, then finish the item manually
- Track opened dates, after-opening lifetimes, freeze-by suggestions, and thawed food
- See use-first priorities, an expiry calendar, Health Canada storage guidance, and private use-it-up ideas
- Save available nutrition details and Nutri-Score from Open Food Facts with clear source notices
- Mark food as used, wasted, or frozen, then restore it from History
- Record partial amounts used or wasted while keeping the remaining stock active
- Shows a lightweight 30-day outcome summary
- Offers recent-food shortcuts for faster repeat entry
- Includes a reusable grocery list grouped by Walmart, Dollarama, or another store
- Seeds the provided regular shopping list once and remembers To buy / Already have status
- Keeps groceries in sync: added/restored food is marked Have, while the last used/wasted match returns to To buy
- Supports low-stock levels, target quantities, suggested restock amounts, focused Shopping Mode, and reusable shopping trips
- Supports System, Light, and Dark appearance with a muted sage-and-brown palette
- Adds touch swipe shortcuts while retaining visible buttons and keyboard access
- Search, filter, and sort the inventory
- Export and restore a complete JSON backup
- Offline app shell, explicit update prompt, light/dark mode, and iPhone safe-area support
- Automated tests run for every pull request

## Run locally

Serve the folder over HTTP rather than opening `index.html` directly. For example:

```sh
npx serve .
```

Then open the local URL. The app can also be hosted as static files on GitHub Pages.

## Tests

```sh
npm test
```

## iPhone installation

1. Open the hosted app in Safari.
2. Tap Share.
3. Choose **Add to Home Screen**.
4. Open FreshCheck from its new Home Screen icon.

Inventory belongs to that installed web app on that device. Use **Backup and restore** regularly to keep a portable copy.

Camera barcode decoding happens on the device. Most standard retail barcodes identify the product but do not include an expiry date, so FreshCheck asks you to confirm that date. Product lookup needs an internet connection; previously saved products can be filled from local history while offline.
