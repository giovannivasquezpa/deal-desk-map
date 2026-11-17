# Synergy BOV kit — the ONE format for every BOV

Every Broker Opinion of Value Synergy delivers is the same 9-page landscape PDF
(navy/cream, Cormorant Garamond + Jost, Synergy footer on every page):

1. Cover — "Broker Opinion of Value · Prepared for ownership", address, tagline, date, PROPERTY PHOTO, 6 stat tiles
2. Value Conclusion — 4 value cards, value table, why
3. Property Summary — fact table, neighborhood context + neighbor table
4. Sales Comparables — comp table (subject row highlighted), notes, sources
5. Adjustment Grid — grid table + the reasoning for Time / Size / Location / Age
6. Cross-Checks — check table, market context cards
7. Income Approach — pro forma table, investor-floor reasoning
8. Pricing and Strategy — list / expected / range cards, 3 steps, "What we need from you"
9. Disclaimer and Contact — disclaimer, sources, advisor contact card (Giovanni by default)

You never design pages. You fill in `sample.json` (copy it, keep the keys) and run:

    python3 build_bov.py bov.json photo.jpg --out "<Street address> - <City> - BOV.pdf"

- Where the kit lives (since Nov 17, 2026):
  - build_bov.py, fonts.css, README.md: this `bov-kit/` folder of the `giovannivasquezpa/deal-desk-map`
    repository (instant BOV runs have it checked out already).
  - sample.json (a real past BOV, kept private): Supabase project jlrtgefytsoioyvqslqz,
    `select data->>'text' from public.docs where collection='config' and id='bov-kit-sample';`
    Save that text as sample.json next to build_bov.py.
  - Older runs without the repository can still read all four files from the old Deal Desk artifact
    (Artifact tool, action "read", url https://claude.ai/artifact/56ZQ7fDnH4cidbSdMJQYZk).
  - `SKILL-synergy-bov.md` is a copy of the synergy-bov skill, for runs where the Skill tool can't load it.
- The photo is REQUIRED — the script refuses to build without one, and a placeholder, map icon or "schematic" box never counts (exterior photo; else the aerial from the PropertyKey / Miami REALTORS
  tax report with a red pin on the subject). Put its source in `photoCaption`.
- `advisor` (optional): only when the BOV is for another Synergy advisor (e.g. Richard Spado) —
  then give that advisor's name/title/email/phone/address and Giovanni is left off entirely.
- Text: plain sentences, `**bold**` for the key figures. +/- for approximate SF. Never invent a figure.
- Tables: `{columns:[{label,align,width}], rows:[[...]], highlight:[row indexes]}`; first column is the label.
  Comps: 6–8 rows plus the subject row (highlighted). Grid: one row per comp.
- The script prints `PROBLEM page N` if a page is still too long — shorten that page's text or rows and rerun.
  "shrunk to 9x%" notes are fine.
- Then LOOK at `... - page-1.png` (cover: photo visible, title on one or two lines, 6 tiles) and skim the others.

Deliver the PDF only. Never publish a BOV as an artifact page, a Doc, or a slide deck.
