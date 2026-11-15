# Deal Desk · Inventory Map

Satellite map of the Deal Desk inventory. Property of Giovanni Vasquez PA.

- `index.html` — the map (GitHub Pages). Asks for the passphrase, then shows every listing on a satellite map with Florida parcel lines; tap a lot for its details.
- `data.enc` — the listings, sealed. Unreadable without the passphrase.
- `vault.json` — public key + passphrase-locked private key.
- `tools/mapcrypt.py` — `seal <listings.json>` refreshes `data.enc` from a Deal Desk export (no passphrase needed); `repass` changes the passphrase.

This repo is public so GitHub Pages can host it for free. Never commit a plain listings file here.
