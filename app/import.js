/* Import from the old desk (Claude artifact).
   Reads the "Export everything" zip files, puts every file back under its same id (so /_blob/ links keep working)
   and writes every record into public.docs. Running it again later is safe: it brings the new desk up to date. */
(() => {
  const sb = window.deskSupabase; if (!sb) return;
  const BUCKET = "desk-files";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---- zip reading (stored zips written by the old desk; plain deflate zips are refused) ---- */
  async function u8(blob) { return new Uint8Array(await blob.arrayBuffer()); }
  async function entries(file) {
    const tailLen = Math.min(file.size, 65557);
    const tail = await u8(file.slice(file.size - tailLen));
    let e = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 5 && tail[i + 3] === 6) { e = i; break; }
    if (e < 0) throw new Error(`${file.name} isn't a zip file`);
    const ev = new DataView(tail.buffer, tail.byteOffset + e);
    const count = ev.getUint16(10, true), cdSize = ev.getUint32(12, true), cdOff = ev.getUint32(16, true);
    const cd = await u8(file.slice(cdOff, cdOff + cdSize)), v = new DataView(cd.buffer);
    const out = []; let p = 0; const dec = new TextDecoder();
    for (let i = 0; i < count; i++) {
      if (v.getUint32(p, true) !== 0x02014b50) throw new Error(`${file.name} looks damaged`);
      const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
      const nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lho = v.getUint32(p + 42, true);
      const name = dec.decode(cd.subarray(p + 46, p + 46 + nl));
      out.push({ name, size, method, lho, file });
      p += 46 + nl + xl + cl;
    }
    return out;
  }
  async function body(en) {
    if (en.method !== 0) throw new Error(`${en.name} is compressed; use the zip straight from the old desk`);
    const h = new DataView((await u8(en.file.slice(en.lho, en.lho + 30))).buffer);
    const start = en.lho + 30 + h.getUint16(26, true) + h.getUint16(28, true);
    return en.file.slice(start, start + en.size);
  }
  function sniff(b) {
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
    if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
    if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
    if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57) return "image/webp";
    return "application/octet-stream";
  }
  const fixUrls = d => JSON.parse(JSON.stringify(d).replace(/https?:\/\/[^"\s]*?\/_blob\//g, "/_blob/"));

  async function existingBlobs() {
    const have = new Set(); let offset = 0;
    for (;;) {
      const { data, error } = await sb.storage.from(BUCKET).list("_blob", { limit: 1000, offset });
      if (error) throw new Error(error.message);
      data.forEach(f => have.add(f.name));
      if (data.length < 1000) break; offset += 1000;
    }
    return have;
  }
  async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); })); }

  /* ---- UI ---- */
  const css = document.createElement("style");
  css.textContent = `#desk-imp{position:fixed;inset:0;z-index:99990;background:rgba(11,18,34,.55);display:flex;align-items:center;justify-content:center;padding:16px}
  #desk-imp .imp-box{display:block;text-align:left;background:#fff;color:#14213d;border-radius:16px;max-width:520px;width:100%;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.35);font:14px -apple-system,BlinkMacSystemFont,sans-serif}
  #desk-imp h3{margin:0 0 6px;font-size:18px}#desk-imp p{margin:6px 0;color:#3d4659}#desk-imp ol{padding-left:20px;color:#3d4659}
  #desk-imp .imp-row{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
  #desk-imp .imp-row button{border:0;border-radius:10px;padding:10px 14px;font-weight:700;cursor:pointer}#desk-imp .pri{background:#14213d;color:#fff}#desk-imp .sec{background:#eee9dc;color:#14213d}
  #desk-imp .imp-log{background:#f7f3ea;border-radius:10px;padding:10px;margin-top:10px;max-height:180px;overflow:auto;font-size:13px;white-space:pre-wrap}
  #desk-imp .imp-bar{height:8px;background:#eee9dc;border-radius:99px;overflow:hidden;margin-top:10px}#desk-imp .imp-bar i{display:block;height:100%;width:0;background:#c9a227;transition:width .2s}
  #desk-imp .imp-chk{display:flex;width:auto;gap:8px;align-items:flex-start;margin-top:10px;font-size:13px}`;
  document.head.appendChild(css);

  let busy = false;
  function open() {
    if (document.getElementById("desk-imp")) return;
    const w = document.createElement("div"); w.id = "desk-imp";
    w.innerHTML = `<div class="imp-box" role="dialog" aria-modal="true" aria-labelledby="imp-t">
      <h3 id="imp-t">Import from the old desk</h3>
      <ol><li>In the old Deal Desk (in Claude), tap <b>Export everything</b> under the update time, top right. It saves a few <b>.zip</b> files.</li>
      <li>Tap <b>Choose zip files</b> below and pick <b>all</b> of them at once.</li></ol>
      <label class="imp-chk"><input type="checkbox" id="imp-mirror" checked> Make this desk match the export exactly (removes records the old desk no longer has)</label>
      <input type="file" id="imp-files" accept=".zip,application/zip" multiple hidden>
      <div class="imp-bar" hidden><i></i></div><div class="imp-log" hidden></div>
      <div class="imp-row"><button type="button" class="sec" id="imp-close">Close</button><button type="button" class="pri" id="imp-pick">Choose zip files</button></div></div>`;
    document.body.appendChild(w);
    w.querySelector("#imp-close").onclick = () => { if (!busy) w.remove(); };
    w.querySelector("#imp-pick").onclick = () => w.querySelector("#imp-files").click();
    w.querySelector("#imp-files").onchange = e => run([...e.target.files], w);
  }

  async function run(files, w) {
    if (!files.length || busy) return;
    busy = true;
    const logEl = w.querySelector(".imp-log"), bar = w.querySelector(".imp-bar"), fill = bar.querySelector("i");
    const pick = w.querySelector("#imp-pick"), close = w.querySelector("#imp-close");
    pick.disabled = close.disabled = true; logEl.hidden = bar.hidden = false; logEl.textContent = "";
    const log = t => { logEl.textContent += t + "\n"; logEl.scrollTop = 1e9; };
    const prog = (a, b) => { fill.style.width = (b ? Math.round(100 * a / b) : 0) + "%"; };
    try {
      let all = [];
      for (const f of files) { const es = await entries(f); all = all.concat(es); log(`${f.name}: ${es.length} items`); }
      const dataEn = all.find(e => e.name === "data.json");
      const data = dataEn ? JSON.parse(await (await body(dataEn)).text()) : null;
      if (data && data.kind !== "deal-desk-export") throw new Error("data.json isn't a Deal Desk export");
      const types = {}; (data ? data.assets : []).forEach(a => (types[a.id] = a.contentType));
      if (data && data.parts) {
        const parts = new Set(all.filter(e => /^part-\d+\.json$/.test(e.name)).map(e => e.name));
        if (parts.size < data.parts) log(`Heads-up: the export has ${data.parts} zip files and you picked ${parts.size}. Missing files can be imported later.`);
      }

      /* files */
      const blobs = all.filter(e => e.name.startsWith("_blob/"));
      const have = await existingBlobs();
      const todo = blobs.filter(e => !have.has(e.name.slice(6)));
      log(`Files: ${blobs.length} in the export, ${blobs.length - todo.length} already here, ${todo.length} to upload.`);
      let done = 0, failed = 0;
      await pool(todo, 3, async en => {
        const id = en.name.slice(6), b = await body(en);
        const head = await u8(b.slice(0, 12));
        const contentType = types[id] || sniff(head);
        const { error } = await sb.storage.from(BUCKET).upload("_blob/" + id, new Blob([b], { type: contentType }), { contentType, upsert: true, cacheControl: "31536000" });
        if (error) { failed++; log(`  couldn't upload ${id}: ${error.message}`); }
        prog(++done, todo.length);
      });
      if (todo.length) log(`Files uploaded: ${done - failed}${failed ? `, ${failed} failed (run Import again to retry)` : ""}.`);

      /* records */
      if (!data) log("No data.json in these zips (it's in part 1), so records were not changed.");
      else {
        const mirror = w.querySelector("#imp-mirror").checked;
        const cols = Object.keys(data.collections || {});
        let rows = 0, removed = 0, step = 0;
        for (const c of cols) {
          const list = data.collections[c] || [];
          let batch = [], bytes = 0;
          const flush = async () => {
            if (!batch.length) return;
            const { error } = await sb.from("docs").upsert(batch, { onConflict: "collection,id" });
            if (error) throw new Error(`${c}: ${error.message}`);
            rows += batch.length; batch = []; bytes = 0;
          };
          for (const r of list) {
            const row = { collection: c, id: String(r.id), data: fixUrls(r.data || {}) };
            const n = JSON.stringify(row.data).length;
            if (bytes + n > 1500000) await flush();
            batch.push(row); bytes += n;
          }
          await flush();
          if (mirror) {
            const keep = new Set(list.map(r => String(r.id)));
            const { data: cur, error } = await sb.from("docs").select("id").eq("collection", c);
            if (!error) {
              const gone = cur.map(x => x.id).filter(id => !keep.has(id));
              for (let i = 0; i < gone.length; i += 200) {
                const { error: de } = await sb.from("docs").delete().eq("collection", c).in("id", gone.slice(i, i + 200));
                if (!de) removed += Math.min(200, gone.length - i);
              }
            }
          }
          prog(++step, cols.length);
          log(`  ${c}: ${list.length}`);
        }
        log(`Records: ${rows} saved${removed ? `, ${removed} removed` : ""}. Exported from the old desk ${new Date(data.exportedAt).toLocaleString()}.`);
      }
      log("Done. The desk updates on its own; you can close this.");
    } catch (e) {
      log("Stopped: " + (e && e.message || e) + "\nNothing is lost; fix the issue and run Import again.");
    } finally {
      busy = false; pick.disabled = close.disabled = false; pick.textContent = "Import more zip files";
    }
  }

  /* header link next to Sign out */
  const t = setInterval(() => {
    const so = document.getElementById("desk-signout"); if (!so) return;
    clearInterval(t);
    const b = document.createElement("button"); b.type = "button"; b.className = "desk-signout"; b.id = "desk-import"; b.textContent = "Import from old desk";
    b.onclick = open;
    so.parentNode.insertBefore(document.createTextNode(" · "), so); so.parentNode.insertBefore(b, so.previousSibling);
  }, 500);
  window.deskImport = open;
  /* empty desk: offer the import right away */
  let asked = false;
  const e = setInterval(() => {
    if (asked || typeof loaded === "undefined" || !loaded || !document.getElementById("desk-signout")) return;
    asked = true; clearInterval(e);
    if (Object.values(S).every(a => !a || !a.length)) open();
  }, 1000);
})();
