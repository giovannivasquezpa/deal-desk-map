---
name: "synergy-bov"
description: "Build a Broker Opinion of Value (BOV) for a Synergy Realty property: DealMachine closed comps, public-record unit sales, adjustment grid, income check, delivered as the 9-page Synergy BOV PDF."
---

# Synergy Realty BOV

Use this skill when Giovanni asks for a BOV, valuation, "what's it worth", or a price opinion on a property. It is often due fast (e.g., a meeting tomorrow), so get to a defensible number quickly, then document it.

## 1. Gather the subject facts
- Look in the property folder he connects (usually under `G:\Shared drives\Synergy Agent Resources\...`) for the Miami REALTORS / PropertyKey tax report PDF. Stage it and extract: folio, address/unit, owner and mailing address, use code, building SF, year built, legal description (condo % interest), sale history, Just/Assessed value, taxes, mortgages, flood zone.
- If the shell mount fails, use device_list_dir / device_stage_files on the Windows path.
- **Main property photo (required).** Every BOV has a real photo of the property on page 1, never a placeholder or schematic box. Use the first good one (800+ px wide): the listing/OM photo; photos or OMs in Drive or Gmail for the address; listing pages or image search for the exact address; otherwise the aerial from the PropertyKey / Miami REALTORS tax report (extract with pymupdf, crop wide, small red pin on the subject). Note its source for the caption.

## 2. ALWAYS run DealMachine for nearby closed sales (required step)
1. `dealmachine_usage` (free) to confirm credits.
2. `dealmachine_enrich_address` with `contact_audience: "none"` → get `dm_property_id`, lat/lng, property type, owner-occupied flag, mortgage detail. This costs 1 credit.
3. `dealmachine_comps` with:
   - `location`: radius 2–2.5 mi around the subject's lat/lng
   - `criteria.property_types`: the subject's type set explicitly (e.g., `["Office"]`, `["Retail"]`, `["Industrial"]`, `["Multi-Family"]`). **Do not rely on `match_property_type: true` alone.** For a commercial condo it returned single-family homes.
   - `timeframe: "all"`, `sort_by: "date"` desc, `limit: 50`, `min_sale_price: 200000`, `sqft_tolerance_percent: 100`, `include_active_listings: true`
4. Keep only arm's-length sales from the last ~3 years ("Full amount stated on Document"). Separate condo units from freestanding buildings, since buildings include land.
5. Ignore DealMachine's own `value_estimation`. It averages decades of sales and isn't reliable for commercial property.
- Residential subjects: match pool status strictly (pool comps only for pool homes, non-pool comps only for non-pool homes).

## 3. Fill gaps with public records and the web
- Same-building sales: HawkinsCRE folio pages (`https://www.hawkinscre.com/miami-cre/<13-digit folio>`). For condos, step through neighboring folios (…010, …020, …030…) to map every unit's size and sale history. Each page also lists "Potential Comps"; exclude the minimum-consideration (QCD/corrective) entries.
- WebSearch (extended) for press-reported sales (Citybiz, Traded, The Real Deal) and current listings/lease rates (CommercialSearch, CommercialCafe, Showcase). LoopNet blocks fetching, so skip it.
- Find at least one lease comp, ideally in the same building, for the income approach.

## 4. Value it
- **Sales comparison (primary for owner-user product):** 6–10 comps. Build an adjustment grid with Time (~+2–3%/yr), Size (small units sell for more per SF), Location/Class, and Age/Quality. Report the adjusted range, mean, and median. Weight same-building, next-door, and most recent sales most heavily, and give the $/SF conclusion.
- **Cross-checks:** Just Market Value ÷ 0.85, the PropertyKey AVM, and the subject's last sale.
- **Income approach:** market rent × SF, less vacancy, taxes, condo dues/CAM, utilities, insurance, management, and reserves, capped at 6.5–7%. For small office/retail condos this usually comes in well below owner-user value; present it as the investor floor and explain why.
- Give the opinion of value, a range (±~$50/SF), and a suggested list price.

## 5. Deliver as the Synergy BOV PDF (always this format; never an artifact page, Doc or slide deck)
The format is fixed: 9-page landscape PDF, navy/cream, Cormorant Garamond + Jost, Synergy footer on every page (the 12720 Cairo Ln / 1402 NW 1st Ct design):
1. Cover: Broker Opinion of Value · Prepared for ownership, address, tagline, date, **main property photo**, 6 stat tiles
2. Value Conclusion (value, $/SF, investor value, list price cards + table)
3. Property Summary (facts table + neighborhood context and neighbors)
4. Sales Comparables table (subject row highlighted; larger/active sales noted beneath)
5. Adjustment Grid, plus the reasoning for Time, Size, Location, Age/Quality
6. Cross-Checks (+ market context: owner's basis, mortgage on record)
7. Income Approach (Investor Floor)
8. Pricing and Strategy: list / expected / range, 3 steps, What we need from you (occupancy/leases, condo dues, parking, condition, loan payoff, timing)
9. Disclaimer ("This Broker Opinion of Value is not an appraisal..."), Sources including the DealMachine search parameters, and the advisor contact card

How to build it (no designing by hand):
- Get the kit from the Deal Desk: Artifact tool, action "read", url https://claude.ai/artifact/56ZQ7fDnH4cidbSdMJQYZk, paths ["bov-kit/README.md","bov-kit/build_bov.py","bov-kit/fonts.css","bov-kit/sample.json"]. Put them in one folder.
- Write bov.json with the same keys as sample.json, then run `python3 build_bov.py bov.json photo.jpg --out "<Street address> - <City> - BOV.pdf"`. It refuses to build without the photo. Fix any "PROBLEM page N" by shortening that page, then look at the page-1 preview.
- Hand over the PDF itself (in chat: SendUserFile; from the BOV tab: upload it to the Deal Desk asset store and save pdfUrl on the request).

Formatting rules:
- Approximate square footage always uses +/- (e.g., 3,359 +/- SF).
- Contact card (default): Giovanni Vasquez, President & Managing Partner | Synergy Realty Advisors | gvasquez@synergyrealtymiami.com | 786.202.3303 | 1839 SW 27th Ave, Miami FL 33145. When the BOV is prepared for another Synergy advisor (e.g., Richard Spado), use that advisor's name and contact info (`advisor` in bov.json) and leave Giovanni off entirely.
- FL license # is not on file. Leave `FL License #: [to be added]` and ask Giovanni before finalizing.
- State the key assumption (e.g., owner-occupied vs. leased) in the value text and list it under What we need from you.

## 6. Reply
State the value and range in one line, the 2–3 comps that drive it, the meeting flags (mortgage, investor vs. owner-user gap), and what is still needed. Then list the sources.