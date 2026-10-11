# FreshCheck

FreshCheck is a private, local-first Progressive Web App for tracking food expiry dates. It is designed to work as an installed iPhone Home Screen app without a paid backend.

## Features

- Inventory is the home screen, grouped by expiry with search, filters, and sorting.
- Add food using barcode scanning or recently added products, then enter its expiry date.
- Keep scanning after each saved item for faster repeat entry.
- Product name, brand, package size, and nutrition are filled from barcode lookup when available.
- A single Automatic restock checkbox adds a food item to Groceries when marked Used.
- Choose stores in Groceries; existing store choices are retained when the item needs buying again.
- Grocery purchases use a simple checklist, with shopping mode and previous trips.
- Record Used, Wasted, or Frozen outcomes; undo changes and restore food from History.
- An expiry calendar, dark mode, local storage, and backup and restore remain available.
- The app works offline; barcode lookup needs a connection unless the product is already saved locally.

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
