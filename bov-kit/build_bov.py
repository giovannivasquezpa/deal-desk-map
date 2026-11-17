#!/usr/bin/env python3
"""
Synergy Realty Advisors - Broker Opinion of Value (BOV) builder.

ONE fixed design for every BOV: the 9-page navy/cream landscape deck
(cover, value conclusion, property, comps, adjustment grid, cross-checks,
income, pricing & strategy, disclaimer & contact). You never design pages:
you write the numbers and words into a JSON file and this script lays them out.

Usage:
    python3 build_bov.py bov.json [photo.jpg] [--out "<Address> - BOV.pdf"]

Needs fonts.css next to this script, and Playwright with Chromium
(pip install playwright --break-system-packages; python3 -m playwright install chromium
 -- usually already installed). Writes the PDF plus page-1.png ... page-9.png previews,
and prints any page whose content had to be shrunk to fit or still overflows.

Text fields accept **bold**. Approximate square footage always uses +/- (e.g. 10,329 +/- SF).
See sample.json for every field.
"""
import base64, html, json, mimetypes, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))

ADVISOR_DEFAULT = {
    "name": "Giovanni Vasquez",
    "title": "President & Managing Partner",
    "company": "Synergy Realty Advisors",
    "email": "gvasquez@synergyrealtymiami.com",
    "phone": "786.202.3303",
    "address": "1839 SW 27th Ave, Miami FL 33145",
    "license": "FL License #: [to be added]",
}

SECTIONS = [
    ("01", "Cover"), ("02", "Value Conclusion"), ("03", "Property Summary"),
    ("04", "Sales Comparables"), ("05", "Adjustment Grid"), ("06", "Cross-Checks"),
    ("07", "Income Approach"), ("08", "Pricing and Strategy"), ("09", "Disclaimer"),
]

# simple red line icons, one per section
ICONS = {
    "tag": '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="8" cy="8" r="1.3"/>',
    "doc": '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 12h6M9 15.5h6M9 9h2"/>',
    "grid": '<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/>',
    "scale": '<path d="M12 3v17M6 20h12M4 7h16M7 7l-3 6h6zM17 7l-3 6h6z"/><path d="M4 13a3 3 0 0 0 6 0M14 13a3 3 0 0 0 6 0"/>',
    "compass": '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    "trend": '<path d="m3 17 6-6 4 4 8-8M15 7h6v6"/>',
}


def esc(s):
    return html.escape(str(s if s is not None else ""))


def rich(s):
    """escape, then **bold**"""
    t = esc(s)
    return re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)


def paras(v, cls="p"):
    if not v:
        return ""
    if isinstance(v, str):
        v = [v]
    return "".join(f'<p class="{cls}">{rich(x)}</p>' for x in v if x)


def icon(name):
    return f'<svg class="sec-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">{ICONS[name]}</svg>'


def table(t, cls=""):
    """t = {columns:[{label, align:'left'|'center'|'right', width:'24%'}], rows:[[...]], highlight:[row idx]}
    The first column is always bold navy. Highlighted rows are blush and bold."""
    if not t or not t.get("rows"):
        return ""
    cols = t.get("columns") or []
    hl = set(t.get("highlight") or [])
    head = "".join(
        f'<th style="text-align:{c.get("align", "center")};{("width:" + c["width"]) if c.get("width") else ""}">{esc(c.get("label", ""))}</th>'
        for c in cols)
    body = ""
    for i, r in enumerate(t["rows"]):
        cells = ""
        for j, v in enumerate(r):
            al = cols[j].get("align", "center") if j < len(cols) else "center"
            cells += f'<td style="text-align:{al}">{rich(v)}</td>'
        body += f'<tr class="{"hl" if i in hl else ""}">{cells}</tr>'
    return f'<table class="tbl {cls}"><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>'


def stat_cards(cards, cls="cards"):
    if not cards:
        return ""
    out = ""
    for c in cards:
        v = rich(c.get("value", ""))
        v = re.sub(r"\s*/\s*SF$", ' <span class="unit">/ SF</span>', v)
        out += f'<div class="card"><div class="cv">{v}</div><div class="cl">{esc(c.get("label", ""))}</div></div>'
    return f'<div class="{cls}" style="--n:{len(cards)}">{out}</div>'


def numbered(items):
    if not items:
        return ""
    out = ""
    for i, it in enumerate(items):
        out += f'<div class="num-item"><div class="num">{i + 1:02d}</div><div><div class="num-t">{rich(it.get("title", ""))}</div><div class="num-x">{rich(it.get("text", ""))}</div></div></div>'
    return f'<div class="numbered">{out}</div>'


def chip(txt, red=False):
    return f'<div class="chip{" red" if red else ""}">{esc(txt)}</div>'


def logo():
    return '<div class="logo"><div class="lg1">Synergy</div><div class="lg2">REALTY ADVISORS</div></div>'


HEX_SVG = ("<svg class='hexes' viewBox='0 0 250 150' preserveAspectRatio='xMinYMin slice'><defs><pattern id='hx' width='30' height='52' patternUnits='userSpaceOnUse' patternTransform='scale(.92)'>"
           "<path d='M15 0 30 8.66v17.32L15 34.64 0 25.98V8.66zM15 34.64V52M0 25.98v0M30 25.98v0' fill='none' stroke='rgba(255,255,255,.22)' stroke-width='1'/></pattern>"
           "<linearGradient id='hf' x1='0' x2='1'><stop offset='0' stop-color='#fff' stop-opacity='.9'/><stop offset='.85' stop-color='#fff' stop-opacity='.5'/><stop offset='1' stop-color='#fff' stop-opacity='0'/></linearGradient>"
           "<mask id='hm'><rect width='250' height='150' fill='url(#hf)'/></mask></defs><rect width='250' height='150' fill='url(#hx)' mask='url(#hm)'/></svg>")

SIDE_HEX = ("<svg class='sidehex' viewBox='0 0 60 90' fill='none' stroke='#c9c6d6' stroke-width='1.2'>"
            "<path d='M15 2h30l15 26-15 26H15L0 28z'/><path d='M22 38h22l11 19-11 19H22L11 57z'/><path d='M38 64h14l7 12-7 12H38l-7-12z'/></svg>")


def footer(n, total, dark=False):
    return f'''<div class="foot{" dark" if dark else ""}">{logo()}
      <div class="foot-addr"><div class="fa1">1839 SW 27th Avenue, Miami, Florida 33145</div><div class="fa2">786.202.3303 &nbsp;·&nbsp; SYNERGYREALTYMIAMI.COM</div></div>
      {HEX_SVG}<div class="pnum">{n:02d} / {total:02d}</div></div>'''


def inner(n, total, d, icon_name, headline, body):
    sec = SECTIONS[n - 1][1]
    return f'''<section class="page inner">
      {icon(icon_name)}
      <div class="runhead"><div class="rh1">SECTION {n:02d} · {esc(sec.upper())}</div><div class="rh2">{esc(d.get("headerLine", "").upper())}</div></div>
      {SIDE_HEX}
      <div class="body">
        <div>{chip(f"SECTION {n:02d} · {sec.upper()}", red=True)}</div>
        <h2>{rich(headline)}</h2><div class="rule"></div>
        <div class="content"><div class="fit">{body}</div></div>
      </div>
      {footer(n, total)}</section>'''


def build_html(d, photo_uri):
    T = 9
    adv = {**ADVISOR_DEFAULT, **(d.get("advisor") or {})}
    css = open(os.path.join(HERE, "fonts.css")).read() + STYLE

    # 1 cover
    stats = "".join(f'<div class="ctile"><div class="ctv">{rich(s.get("value", ""))}</div><div class="ctl">{esc(s.get("label", ""))}</div></div>' for s in (d.get("coverStats") or [])[:6])
    photo = (f'<div class="cphoto"><img src="{photo_uri}"><div class="cap">{esc(d.get("photoCaption", ""))}</div></div>'
             if photo_uri else '<div class="cphoto empty">PROPERTY PHOTO REQUIRED</div>')
    cover = f'''<section class="page cover">
      <div class="cover-hex"></div>
      <div class="cbody">
        <div class="cbanner">BROKER OPINION OF VALUE <span>·</span> {esc((d.get("preparedFor") or "Prepared for ownership").upper())}</div>
        <h1>{rich(d.get("title") or d.get("address", ""))}</h1>
        <div class="ctag">{rich(d.get("tagline", ""))}</div><div class="crule"></div>
        <div class="cdate">{esc(d.get("date", ""))}</div>
        {photo}
        <div class="ctiles" style="--n:{max(1, len((d.get("coverStats") or [])[:6]))}">{stats}</div>
      </div>
      {footer(1, T, dark=True)}</section>'''

    v = d.get("value") or {}
    p2 = inner(2, T, d, "tag", v.get("headline", "Our Opinion of Value"),
               stat_cards(v.get("cards"), "cards") +
               f'<div class="split s60">{table(v.get("table"))}<div class="side">{paras(v.get("text"))}</div></div>')

    pr = d.get("property") or {}
    facts = "".join(f'<tr><th>{esc(k).upper()}</th><td>{rich(val)}</td></tr>' for k, val in (pr.get("facts") or []))
    p3 = inner(3, T, d, "doc", pr.get("headline", "The Property"),
               f'''<div class="split s45"><div><table class="facts">{facts}</table><div class="src">{rich(pr.get("source", ""))}</div></div>
               <div class="side">{chip(pr.get("contextTitle", "").upper()) if pr.get("contextTitle") else ""}{paras(pr.get("contextText"))}{table(pr.get("table"))}</div></div>''')

    c = d.get("comps") or {}
    p4 = inner(4, T, d, "grid", c.get("headline", "Recent Sales"),
               table(c.get("table"), "wide") + paras(c.get("text"), "p lead") + (f'<div class="src">{rich(c.get("sources"))}</div>' if c.get("sources") else ""))

    g = d.get("grid") or {}
    p5 = inner(5, T, d, "scale", g.get("headline", "Adjusting to the Subject"),
               f'<div class="split s62"><div>{table(g.get("table"))}{paras(g.get("text"), "p lead")}</div><div class="side">{numbered(g.get("notes"))}</div></div>')

    x = d.get("checks") or {}
    p6 = inner(6, T, d, "compass", x.get("headline", "Testing the Number"),
               f'''<div class="split s56"><div>{table(x.get("table"))}{paras(x.get("text"), "p lead")}</div>
               <div class="side">{chip(x.get("contextTitle", "MARKET CONTEXT").upper())}{paras(x.get("contextIntro"))}{stat_cards(x.get("cards"), "cards small")}{paras(x.get("contextText"))}</div></div>''')

    inc = d.get("income") or {}
    p7 = inner(7, T, d, "trend", inc.get("headline", "The Investor View"),
               f'<div class="split s58">{table(inc.get("table"))}<div class="side">{paras(inc.get("text"))}{("<div class=src>" + rich(inc.get("note")) + "</div>") if inc.get("note") else ""}</div></div>')

    s = d.get("strategy") or {}
    needs = "".join(f"<li>{rich(n)}</li>" for n in (s.get("needs") or []))
    p8 = inner(8, T, d, "tag", s.get("headline", "Our Recommendation"),
               stat_cards(s.get("cards"), "cards") +
               f'<div class="split s54">{numbered(s.get("steps"))}<div class="side">{chip("WHAT WE NEED FROM YOU") if needs else ""}<ul class="needs">{needs}</ul></div></div>')

    ds = d.get("disclaimer") or {}
    dtext = ds.get("text") or [
        f"This Broker Opinion of Value is not an appraisal and should not be relied upon as such. It is an opinion of the probable selling price, prepared by a licensed real estate broker from public records, market data and the information available on {d.get('date', '')}, without an interior inspection or a review of leases or building conditions.",
        "Income figures are pro forma estimates based on market rents and expenses, not the property's actual performance. Actual value and sale price may differ. Information from third-party sources is believed reliable but is not guaranteed."]
    contact = f'''<div class="contact"><div class="cn">{esc(adv["name"])}</div><div class="ct">{esc(adv["title"]).upper()}</div>
        <div class="cline">{esc(adv["company"])}</div><div class="cline">{esc(adv["email"])}</div><div class="cline">{esc(adv["phone"])}</div>
        <div class="cline">{esc(adv["address"])}</div><div class="clic">{esc(adv.get("license") or "")}</div></div>'''
    p9 = inner(9, T, d, "doc", ds.get("headline", "Disclaimer and Contact"),
               f'<div class="split s56"><div>{paras(dtext)}<div class="src">{rich(ds.get("sources", ""))}</div></div><div class="side ctr">{contact}</div></div>')

    return f'''<!doctype html><html><head><meta charset="utf-8"><title>{esc(d.get("address", ""))} - Broker Opinion of Value</title>
      <style>{css}</style></head><body>{cover}{p2}{p3}{p4}{p5}{p6}{p7}{p8}{p9}</body></html>'''


STYLE = r"""
@page{size:13.3333in 7.5in;margin:0}
:root{--navy:#1b1464;--navy2:#120d45;--cream:#efece3;--card:#efece3;--red:#e2232b;--blush:#eeddd5;--ink:#1b1464;--muted:#5e5b6b;--line:#d6d2c8}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:'Jost',sans-serif;color:var(--ink);font-weight:300}
b{font-weight:600;color:var(--navy)}
.page{position:relative;width:1280px;height:720px;overflow:hidden;page-break-after:always;break-after:page;background:var(--cream)}
.page:last-child{page-break-after:auto;break-after:auto}

/* footer band */
.foot{position:absolute;left:0;right:0;bottom:0;height:120px;background:var(--navy);display:flex;align-items:center;padding-left:60px;gap:24px}
.foot.dark{background:var(--navy2)}
.logo{width:134px;height:53px;border-radius:8px;background:#f0ebe5;display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 6px 14px rgba(0,0,0,.35)}
.lg1{font:500 17px/1 'Cormorant Garamond',serif;color:var(--navy);letter-spacing:.01em}
.lg2{font:600 5.6px/1 'Jost';color:var(--red);letter-spacing:.32em;margin-top:5px}
.foot-addr{color:#fff}
.fa1{font:600 13px 'Jost';letter-spacing:.05em}
.fa2{font:400 9.5px 'Jost';letter-spacing:.14em;color:rgba(255,255,255,.55);margin-top:4px}
.hexes{position:absolute;right:130px;top:0;width:200px;height:120px}
.pnum{position:absolute;right:60px;top:47px;font:600 12px 'Jost';letter-spacing:.14em;color:var(--red);background:#130d4b;border-radius:6px;padding:6px 10px;box-shadow:0 2px 6px rgba(0,0,0,.4)}

/* inner page chrome */
.inner .sec-icon{position:absolute;left:80px;top:62px;width:28px;height:28px;color:var(--red)}
.runhead{position:absolute;right:80px;top:63px;text-align:right}
.rh1{font:600 10px 'Jost';letter-spacing:.2em;color:#5b5868}
.rh2{font:400 8px 'Jost';letter-spacing:.2em;color:#8a8796;margin-top:6px}
.sidehex{position:absolute;right:6px;top:264px;width:58px;height:86px}
.body{position:absolute;left:80px;right:80px;top:122px;bottom:142px;display:flex;flex-direction:column}
.fit{transform-origin:top left}
.chip{display:inline-block;font:600 9.5px 'Jost';letter-spacing:.17em;padding:6px 12px;border-radius:999px;background:var(--cream);color:var(--navy);box-shadow:3px 4px 9px rgba(0,0,0,.08),-2px -2px 6px rgba(255,255,255,.7);margin-bottom:10px}
.chip.red{color:var(--red)}
h2{font:600 40px/1.05 'Cormorant Garamond',serif;color:var(--navy);margin:0;letter-spacing:-.005em}
h2 b{font-weight:600}
.rule{width:64px;height:2px;background:var(--red);margin:13px 0 0}
.content{margin-top:30px;flex:1;min-height:0;position:relative}
.p{font:300 13px/1.42 'Jost';color:#3f3c4d;margin:0 0 10px}
.p.lead{margin-top:14px}
.src{font:300 8.6px/1.6 'Jost';color:#5e5b6b;margin-top:8px}

/* stat cards */
.cards{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:16px;margin-bottom:26px}
.card{background:var(--card);border-radius:14px;padding:22px 10px 18px;text-align:center;box-shadow:6px 8px 16px rgba(0,0,0,.09),-4px -4px 10px rgba(255,255,255,.85)}
.cv{font:600 30px/1.05 'Cormorant Garamond',serif;color:var(--navy)}
.cv .unit{font-size:16px;color:var(--red)}
.cl{font:500 9.5px 'Jost';letter-spacing:.2em;color:#4b4858;margin-top:9px;text-transform:uppercase}
.cards.small{gap:14px;margin:14px 0 18px}
.cards.small .card{padding:22px 8px 16px}
.cards.small .cv{font-size:28px}

/* tables */
.tbl{width:100%;border-collapse:separate;border-spacing:0;border-radius:10px;overflow:hidden;box-shadow:5px 7px 15px rgba(0,0,0,.09),-3px -3px 8px rgba(255,255,255,.7);font-size:11.5px}
.tbl th{background:var(--navy);color:#fff;font:600 9.5px 'Jost';letter-spacing:.17em;text-transform:uppercase;padding:8.5px 11px;border-right:1px solid rgba(255,255,255,.08)}
.tbl td{padding:7.2px 11px;border-top:1px solid var(--line);font:300 11.5px 'Jost';color:#3f3c4d;background:var(--cream)}
.tbl td:first-child{font-weight:500;color:var(--navy)}
.tbl tr.hl td{background:var(--blush);font-weight:500;color:var(--navy)}
.tbl tr:first-child td{border-top:0}

/* property facts */
.facts{width:100%;border-collapse:separate;border-spacing:0;background:var(--cream);border-radius:12px;box-shadow:5px 7px 15px rgba(0,0,0,.09),-3px -3px 8px rgba(255,255,255,.7);padding:4px 11px}
.facts th{text-align:left;font:400 10.5px 'Jost';letter-spacing:.14em;color:#4b4858;padding:5.3px 0;border-bottom:1px solid var(--line);white-space:nowrap}
.facts td{text-align:right;font:400 12.5px 'Jost';color:var(--navy);padding:5.3px 0 5.3px 14px;border-bottom:1px solid var(--line)}
.facts tr:last-child th,.facts tr:last-child td{border-bottom:0}

/* layouts */
.split{display:grid;gap:40px;align-items:start}
.s60{grid-template-columns:900fr 600fr}.s45{grid-template-columns:650fr 700fr;gap:50px}
.s62{grid-template-columns:900fr 500fr;gap:50px}.s56{grid-template-columns:800fr 550fr;gap:50px}
.s58{grid-template-columns:830fr 560fr;gap:50px}.s54{grid-template-columns:740fr 600fr;gap:56px}
.side .p{font-size:13px}
.side .tbl{margin-top:16px}
.side.ctr{display:flex;justify-content:flex-end}

.numbered{display:grid;gap:15px}
.num-item{display:grid;grid-template-columns:42px 1fr;gap:0}
.num{font:600 17px 'Cormorant Garamond',serif;color:var(--red);padding-top:1px}
.num-t{font:500 13.5px 'Jost';color:var(--navy)}
.num-x{font:300 11.5px/1.45 'Jost';color:#5e5b6b;margin-top:4px}
.needs{list-style:none;padding:0;margin:6px 0 0;display:grid;gap:12px}
.needs li{font:300 13px 'Jost';color:#3f3c4d;padding-left:22px;position:relative}
.needs li::before{content:"";position:absolute;left:3px;top:6px;width:6px;height:6px;border-radius:50%;background:var(--navy)}

.contact{width:430px;background:var(--cream);border-radius:14px;padding:30px 30px 28px;box-shadow:8px 10px 22px rgba(0,0,0,.1),-5px -5px 12px rgba(255,255,255,.85)}
.cn{font:600 31px 'Cormorant Garamond',serif;color:var(--navy)}
.ct{font:600 10.5px 'Jost';letter-spacing:.22em;color:var(--red);margin:10px 0 18px}
.cline{font:300 13px 'Jost';color:#3f3c4d;margin-bottom:10px}
.clic{font:300 10.5px 'Jost';color:#5e5b6b;margin-top:4px}

/* cover */
.cover{background:var(--navy)}
.cover-hex{position:absolute;inset:0 0 120px 0;opacity:.5;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='52' height='90' viewBox='0 0 52 90'%3E%3Cpath d='M26 0 52 15v30L26 60 0 45V15zM26 60v30' fill='none' stroke='%23332c80' stroke-width='1.2'/%3E%3C/svg%3E")}
.cbody{position:absolute;inset:0 0 120px 0;display:flex;flex-direction:column;align-items:center;padding-top:44px}
.cbanner{width:716px;border-top:1px solid rgba(255,255,255,.18);border-bottom:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.03);text-align:center;font:600 12.5px 'Jost';letter-spacing:.32em;color:var(--red);padding:15px 0}
.cbanner span{margin:0 14px;color:rgba(255,255,255,.4)}
.cover h1{font:600 62px/1.05 'Cormorant Garamond',serif;color:#fff;margin:26px 0 0;text-align:center;max-width:1100px}
.ctag{font:italic 500 21px 'Cormorant Garamond',serif;color:#e7e4f3;margin-top:10px;text-align:center;max-width:1000px}
.crule{width:80px;height:2px;background:var(--red);margin:14px 0 0}
.cdate{font:300 16px 'Jost';letter-spacing:.06em;color:#d9d6e8;margin-top:22px}
.cphoto{position:relative;width:436px;height:196px;margin-top:16px;border:1.5px dashed rgba(255,255,255,.45);border-radius:6px;overflow:hidden;background:#2a2475}
.cphoto img{width:100%;height:100%;object-fit:cover;display:block}
.cphoto .cap{position:absolute;left:8px;bottom:5px;font:400 8.5px 'Jost';color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.9)}
.cphoto.empty{display:grid;place-items:center;font:600 12px 'Jost';letter-spacing:.2em;color:var(--red);background:#fff}
.ctiles{position:absolute;left:80px;right:80px;bottom:10px;display:grid;grid-template-columns:repeat(var(--n),1fr);gap:12px}
.ctile{background:#241d74;border-radius:12px;padding:15px 6px 13px;text-align:center;box-shadow:0 8px 18px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.06)}
.ctv{font:600 22px/1.1 'Cormorant Garamond',serif;color:#fff}
.ctl{font:500 8.6px 'Jost';letter-spacing:.2em;color:#cfcbe6;margin-top:6px;text-transform:uppercase}
"""

FIT_JS = """() => {
  const out = [];
  document.querySelectorAll('.page.inner').forEach((pg, i) => {
    const box = pg.querySelector('.content'), fit = pg.querySelector('.fit');
    let s = 1;
    while (fit.scrollHeight * s > box.clientHeight + 1 && s > 0.72) { s -= 0.02; fit.style.transform = `scale(${s})`; fit.style.width = (100 / s) + '%'; }
    const over = fit.scrollHeight * s > box.clientHeight + 1;
    if (s < 1 || over) out.push({page: i + 2, scale: Math.round(s * 100), overflow: over});
  });
  const cv = document.querySelector('.cover h1');
  if (cv && cv.scrollWidth > cv.clientWidth + 2) out.push({page: 1, note: 'cover title too wide'});
  return out;
}"""


def main():
    args = [a for a in sys.argv[1:]]
    out = None
    if "--out" in args:
        i = args.index("--out"); out = args[i + 1]; del args[i:i + 2]
    if not args:
        print(__doc__); sys.exit(1)
    data = json.load(open(args[0]))
    photo = args[1] if len(args) > 1 else data.get("photo")
    uri = ""
    if photo:
        if not os.path.exists(photo):
            sys.exit(f"Photo not found: {photo}")
        mt = mimetypes.guess_type(photo)[0] or "image/jpeg"
        uri = f"data:{mt};base64," + base64.b64encode(open(photo, "rb").read()).decode()
    else:
        sys.exit("STOP: no property photo. Every BOV must have a main photo on page 1 (exterior photo, or the aerial "
                 "from the PropertyKey / Miami REALTORS tax report with a red pin on the subject). Find one and rerun: "
                 "python3 build_bov.py bov.json photo.jpg")
    from PIL import Image as _I
    try:
        w, h = _I.open(photo).size
        if w < 500 or h < 250:
            sys.exit(f"STOP: the photo is too small ({w}x{h}). Use one at least 800 px wide.")
    except ImportError:
        pass
    out = out or (re.sub(r'[\\/:*?"<>|]', "", data.get("address", "BOV")) + " - BOV.pdf")
    html_doc = build_html(data, uri)
    html_path = os.path.splitext(out)[0] + ".html"
    open(html_path, "w").write(html_doc)

    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1280, "height": 720})
        pg.goto("file://" + os.path.abspath(html_path))
        pg.evaluate("document.fonts.ready")
        pg.wait_for_timeout(300)
        fit = pg.evaluate(FIT_JS)
        pg.pdf(path=out, width="13.3333in", height="7.5in", print_background=True, margin={"top": "0", "right": "0", "bottom": "0", "left": "0"})
        base = os.path.splitext(out)[0]
        for i, el in enumerate(pg.query_selector_all(".page")):
            el.screenshot(path=f"{base} - page-{i + 1}.png")
        b.close()
    print("PDF:", os.path.abspath(out))
    print("Previews:", f"{os.path.splitext(out)[0]} - page-1.png ... page-9.png")
    for f in fit:
        if f.get("overflow") or f.get("note"):
            print(f"PROBLEM page {f['page']}: {f.get('note') or 'content still too long at 72% size - shorten the text or table on this page'}")
        else:
            print(f"note: page {f['page']} shrunk to {f['scale']}% to fit (fine; shorten text if it looks small)")


if __name__ == "__main__":
    main()
