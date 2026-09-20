# FreshCheck

FreshCheck is a private, local-first Progressive Web App for tracking food expiry dates. It is designed to work as an installed iPhone Home Screen app without a paid backend.

## Features

- Groups active food into Expired, Use soon, and Later
- Stores inventory in IndexedDB and migrates the original `localStorage` records automatically
- Add and edit names, dates, quantities, units, locations, and notes
- Mark food as used, restore it, or delete it with an undo window
- Search, filter, and sort the inventory
- Export and restore a complete JSON backup
- Offline app shell, explicit update prompt, light/dark mode, and iPhone safe-area support
- Optional camera OCR with manual date confirmation; scanning requires a network connection

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
