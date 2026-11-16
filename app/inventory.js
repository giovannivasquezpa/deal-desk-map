/* Inventory tab = satellite map (with its own property list column and Filter button) by default,
   with a switch to the detailed cards. The map lives in /map/?embed=1 and gets the listings live from this page. */
(() => {
  const css = document.createElement("style");
  css.textContent = `
  .invswitch{display:flex;gap:6px;align-items:center;margin:10px 0 8px}
  .invswitch button{border:1px solid #d6d1c4;background:#fff;color:#14213d;border-radius:999px;padding:7px 14px;font-weight:600;cursor:pointer;font-size:13px}
  .invswitch button[aria-pressed="true"]{background:#14213d;color:#fff;border-color:#14213d}
  .invswitch small{color:#5b6475;margin-left:6px}
  #invmap{position:relative;height:calc(100vh - 120px);min-height:460px;border-radius:14px;overflow:hidden;border:1px solid #e3e1da;margin-bottom:16px;background:#0b1222}
  #invmap iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
  body.inv-map #filters,body.inv-map #capbar,body.inv-map #list,body.inv-map #buyer-search{display:none!important}
  @media (max-width:700px){#invmap{height:calc(100vh - 90px);border-radius:10px}}`;
  document.head.appendChild(css);

  let mode = "map";
  try { mode = localStorage.getItem("desk.invMode") || "map"; } catch (_) {}
  const sw = document.createElement("div");
  sw.className = "invswitch"; sw.hidden = true;
  sw.innerHTML = `<button type="button" data-m="map">🗺 Map</button><button type="button" data-m="cards">Cards</button><small id="inv-note"></small>`;
  const pane = document.createElement("section");
  pane.id = "invmap"; pane.hidden = true; pane.setAttribute("aria-label", "Inventory map");
  const filters = document.getElementById("filters");
  filters.parentNode.insertBefore(sw, filters);
  filters.parentNode.insertBefore(pane, filters);

  let frame = null, mapReady = false, sentRef = null;
  function ensureFrame() {
    if (frame) return;
    frame = document.createElement("iframe");
    frame.title = "Inventory map"; frame.src = "/map/?embed=1"; frame.allow = "geolocation";
    pane.appendChild(frame);
  }
  function send(force) {
    if (!frame || !mapReady || !loaded) return;
    if (!force && sentRef === S.listings) return;
    sentRef = S.listings;
    frame.contentWindow.postMessage({ type: "desk-listings", listings: JSON.parse(JSON.stringify(S.listings)), at: new Date().toISOString() }, location.origin);
  }
  function sync() {
    const inv = tab === "listings";
    sw.hidden = !inv;
    sw.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.m === mode)));
    const onMap = inv && mode === "map";
    pane.hidden = !onMap;
    document.body.classList.toggle("inv-map", onMap);
    if (onMap) { ensureFrame(); send(false); }
    else if (frame) send(false);
  }
  sw.addEventListener("click", e => {
    const b = e.target.closest("[data-m]"); if (!b) return;
    mode = b.dataset.m; try { localStorage.setItem("desk.invMode", mode); } catch (_) {}
    render();
  });
  document.addEventListener("click", e => {
    if (!e.target.closest("[data-invmap]")) return;
    mode = "map"; try { localStorage.setItem("desk.invMode", mode); } catch (_) {}
    render();
  });
  window.addEventListener("message", async e => {
    if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow || !e.data) return;
    const m = e.data;
    if (m.type === "desk-map-ready") { mapReady = true; send(true); }
    if (m.type === "desk-placed" && db && canWrite) {
      const l = S.listings.find(x => x.id === m.id);
      if (l && l.lat == null) db.doc("listings/" + m.id).update({ lat: m.lat, lng: m.lng, geoSource: m.geoSource || "" }).catch(() => {});
    }
    if (m.type === "desk-open") {
      const l = S.listings.find(x => x.id === m.id); if (!l) return;
      mode = "cards"; try { localStorage.setItem("desk.invMode", mode); } catch (_) {}
      const q = document.getElementById("buyer-query");
      render();
      if (q) { q.value = l.address || l.name || ""; q.dispatchEvent(new Event("input", { bubbles: true })); }
      window.scrollTo({ top: (document.getElementById("list") || document.body).getBoundingClientRect().top + scrollY - 80, behavior: "smooth" });
    }
  });

  /* run after the desk draws, every time */
  const draw = render;
  render = function () { const r = draw.apply(this, arguments); try { sync(); } catch (e) { console.error(e); } return r; };
  sync();
})();
