# Deal Desk

Giovanni Vasquez PA's private owner CRM, served at https://desk.giovannivasquez.com. Property of Giovanni Vasquez PA.

This repo holds **code only**. All data (buyers, listings, matches, files) lives in the private Supabase project `deal-desk` and is readable only by the email addresses in `public.desk_users`. Never commit a data export here — the repo is public so GitHub Pages can host it.

## Layout
- `index.html` — the Deal Desk app (ported from the Claude artifact, same features).
- `app/shim.js` — runtime the page talks to: sign-in (email link), database (`public.docs`), files (bucket `desk-files`), AI and tool requests (queued in `public.jobs` for the desk agent).
- `app/inventory.js` — Inventory tab: satellite map with property list and Filter, or the detailed cards.
- `app/supabase.js` — supabase-js 2.119.0 (vendored).
- `sw.js` — serves `/_blob/<id>` file links from the private bucket, only to a signed-in session.
- `map/` — the satellite inventory map. Inside the app it gets listings live (`/map/?embed=1`). Opened on its own (`/map/`) it is the older passphrase map that reads `data.enc` + `vault.json` (kept until the switch).
- `tools/mapcrypt.py` — (local only) reseals `data.enc` for the passphrase map.

## Queue (`public.jobs`)
`kind = 'ai'`: payload `{mode: 'json'|'text', input, modelTier, images: [storage paths]}` → set `status='done'`, `result = {value}` (json) or `{text}`.
`kind = 'tool'`: payload `{server, tool, args}` (Gmail `create_draft`, Deal machine `dealmachine_enrich_address`, Claude Code Remote `fire_trigger`) → `result` = the tool's result.
On failure set `status='error'` and `error`.
