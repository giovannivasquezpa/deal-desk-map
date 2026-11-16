/* Deal Desk · cloud runtime
   The desk page was written for Claude's artifact runtime (window.claude.use("db"), "assets", "sample", ...).
   This file gives the same page the same calls, backed by Giovanni Vasquez PA's own Supabase project:
     db        -> table public.docs (collection, id, data) with live updates
     assets    -> private storage bucket desk-files, served at /_blob/<id> by sw.js
     sample    -> AI requests queued in public.jobs, answered by the desk agent
     mcp       -> Gmail / DealMachine / trigger calls queued in public.jobs, done by the desk agent
     downloads -> a normal browser download
   Nobody gets past the sign-in screen unless their email is in public.desk_users. */
(() => {
  const CFG = {
    url: "https://jlrtgefytsoioyvqslqz.supabase.co",
    key: "sb_publishable_WBYTdRVeLklHuYussYe7Zg_RZK4lvHJ",
    bucket: "desk-files",
    maxUpload: 20 * 1024 * 1024
  };
  const sb = window.supabase.createClient(CFG.url, CFG.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "desk.auth" }
  });
  window.deskSupabase = sb;

  const err = (code, message) => Object.assign(new Error(message || code), { code });
  const clean = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, "");

  /* ---------- token for the file server (sw.js) ---------- */
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("desk-sw", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function saveToken(s) {
    try {
      const d = await idb();
      await new Promise(res => { const t = d.transaction("kv", "readwrite"); t.objectStore("kv").put(s ? { token: s.access_token, exp: s.expires_at, url: CFG.url, key: CFG.key, bucket: CFG.bucket } : null, "auth"); t.oncomplete = res; t.onerror = res; });
    } catch (_) {}
    try { navigator.serviceWorker && navigator.serviceWorker.controller && navigator.serviceWorker.controller.postMessage({ type: "auth" }); } catch (_) {}
  }
  async function swReady() {
    if (!("serviceWorker" in navigator)) return;
    try {
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      if (!navigator.serviceWorker.controller) {
        await new Promise(r => { navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }); setTimeout(r, 5000); });
      }
    } catch (e) { console.warn("File server not started", e); }
  }

  /* ---------- sign-in gate ---------- */
  let session = null, allowed = false;
  let openRes; const opened = new Promise(r => (openRes = r));
  const css = `
  #desk-gate{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,#14213d,#0b1222);padding:20px;font:15px -apple-system,BlinkMacSystemFont,Inter,sans-serif}
  #desk-gate form{background:#f7f3ea;color:#14213d;border-radius:18px;padding:28px 24px;width:100%;max-width:380px;box-shadow:0 20px 60px rgba(0,0,0,.4)}
  #desk-gate h1{margin:0 0 2px;font-size:22px}#desk-gate .who{margin:0 0 16px;color:#5b6475;font-size:13px}
  #desk-gate input{width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #d6d1c4;font-size:16px;background:#fff;color:#14213d}
  #desk-gate button{width:100%;margin-top:12px;padding:12px;border:0;border-radius:10px;background:#14213d;color:#fff;font-weight:700;font-size:15px;cursor:pointer}
  #desk-gate button[disabled]{opacity:.6}
  #desk-gate .msg{font-size:13px;min-height:18px;margin-top:10px;color:#5b6475}#desk-gate .msg.bad{color:#c0392b}
  #desk-q{position:fixed;left:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:9999;background:#14213d;color:#fff;border:0;border-radius:999px;padding:8px 14px;font:600 13px -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer}
  #desk-qp{position:fixed;left:12px;bottom:calc(56px + env(safe-area-inset-bottom,0px));z-index:9999;background:#fff;color:#14213d;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.25);padding:12px 14px;max-width:min(420px,calc(100vw - 24px));max-height:50vh;overflow:auto;font:13px -apple-system,BlinkMacSystemFont,sans-serif}
  #desk-qp li{margin:6px 0}#desk-qp small{color:#5b6475}
  .desk-signout{background:none;border:0;padding:0;color:inherit;text-decoration:underline;cursor:pointer;font:inherit}`;
  function addCss() { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); }

  function gate(msg, bad) {
    let g = document.getElementById("desk-gate");
    if (!g) {
      g = document.createElement("div"); g.id = "desk-gate";
      g.innerHTML = `<form autocomplete="on"><h1>Deal Desk</h1><p class="who">Giovanni Vasquez PA · private</p>
        <input type="email" id="desk-email" placeholder="Your email" autocomplete="email" required>
        <button type="submit" id="desk-send">Email me a sign-in link</button>
        <div class="msg" role="status"></div></form>`;
      document.body.appendChild(g);
      const f = g.querySelector("form");
      try { f.querySelector("input").value = localStorage.getItem("desk.email") || ""; } catch (_) {}
      f.addEventListener("submit", async e => {
        e.preventDefault();
        const email = f.querySelector("input").value.trim(), b = f.querySelector("button");
        try { localStorage.setItem("desk.email", email); } catch (_) {}
        b.disabled = true; say("Sending…");
        const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + "/" } });
        if (!error) {
          /* Supabase allows one sign-in email per minute; hold the button so a second tap can't trip that */
          let left = 60; b.textContent = `Link sent · resend in ${left}s`;
          const t = setInterval(() => { left--; if (left <= 0) { clearInterval(t); b.disabled = false; b.textContent = "Email me a sign-in link"; } else b.textContent = `Link sent · resend in ${left}s`; }, 1000);
        } else b.disabled = false;
        if (error) say(/rate|seconds/i.test(error.message) ? "Too many tries. Wait a minute and try again." : /signup|not allowed|not found/i.test(error.message) ? "This email doesn't have access to the desk." : error.message, true);
        else say("Check your inbox and tap the sign-in link. You can close this tab.");
      });
    }
    function say(t, isBad) { const m = g.querySelector(".msg"); m.textContent = t || ""; m.classList.toggle("bad", !!isBad); }
    g.hidden = false; say(msg, bad);
  }
  function ungate() { const g = document.getElementById("desk-gate"); if (g) g.hidden = true; }

  async function checkAccess() {
    const { data, error } = await sb.from("desk_users").select("email").limit(1);
    return !error && data && data.length > 0;
  }
  async function onSession(s) {
    session = s;
    await saveToken(s);
    if (!s) { allowed = false; gate(""); return; }
    if (!allowed) {
      allowed = await checkAccess();
      if (!allowed) { gate(`${s.user.email} doesn't have access to this desk.`, true); await sb.auth.signOut(); return; }
    }
    ungate();
    addSignOut();
    openRes();
  }
  function addSignOut() {
    if (document.getElementById("desk-signout")) return;
    const sub = document.querySelector("header .sub"); if (!sub) return;
    const span = document.createElement("span");
    span.innerHTML = ` · <button type="button" class="desk-signout" id="desk-signout">Sign out</button>`;
    sub.appendChild(span);
    span.querySelector("button").onclick = async () => { await sb.auth.signOut(); location.reload(); };
  }

  /* ---------- db ---------- */
  const cache = {};      // collection -> Map(id -> data)
  const loading = {};    // collection -> Promise
  const subs = {};       // collection -> Set({next, error})
  const timers = {};
  function snapshot(col) {
    const docs = [...(cache[col] || new Map()).entries()].map(([id, data]) => ({ id, exists: true, data: () => structuredClone(data), ref: docRef(col + "/" + id) }));
    return { docs, size: docs.length, empty: !docs.length, forEach: f => docs.forEach(f) };
  }
  function emit(col) {
    clearTimeout(timers[col]);
    timers[col] = setTimeout(() => {
      const s = snapshot(col);
      (subs[col] || []).forEach(o => { try { o.next(s); } catch (e) { console.error(e); } });
    }, 25);
  }
  async function loadCol(col) {
    if (!loading[col]) loading[col] = (async () => {
      const m = new Map(); let from = 0; const step = 500;
      for (;;) {
        const { data, error } = await sb.from("docs").select("id,data").eq("collection", col).order("id").range(from, from + step - 1);
        if (error) { delete loading[col]; throw err("permission_denied", error.message); }
        data.forEach(r => m.set(r.id, r.data || {}));
        if (data.length < step) break; from += step;
      }
      cache[col] = m;
    })();
    return loading[col];
  }
  async function refetch(col, id) {
    const { data } = await sb.from("docs").select("data").eq("collection", col).eq("id", id).maybeSingle();
    if (!cache[col]) return;
    if (data) cache[col].set(id, data.data || {}); else cache[col].delete(id);
    emit(col);
  }
  let channel = null;
  function listen() {
    if (channel) return;
    let wasDown = false;
    channel = sb.channel("desk-docs")
      .on("postgres_changes", { event: "*", schema: "public", table: "docs" }, p => {
        const row = p.new && p.new.collection ? p.new : p.old || {};
        const col = row.collection, id = row.id;
        if (!col || !cache[col]) return;
        if (p.eventType === "DELETE") { cache[col].delete(id); emit(col); return; }
        if (p.new && p.new.data && typeof p.new.data === "object") { cache[col].set(id, p.new.data); emit(col); }
        else refetch(col, id);
      })
      .subscribe(status => {
        if (status === "SUBSCRIBED" && wasDown) {
          wasDown = false;
          Object.keys(cache).forEach(c => { delete loading[c]; loadCol(c).then(() => emit(c)).catch(() => {}); });
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") wasDown = true;
      });
  }
  function split(path) {
    path = String(path).replace(/^\/+/, "");
    const i = path.indexOf("/");
    if (i < 1 || i === path.length - 1) throw err("invalid_argument", "A document path looks like collection/id");
    return [path.slice(0, i), path.slice(i + 1)];
  }
  function local(col, id, data) { if (cache[col]) { if (data === null) cache[col].delete(id); else cache[col].set(id, data); emit(col); } }
  function docRef(path) {
    const [col, id] = split(path);
    return {
      id, path: col + "/" + id,
      async get() {
        const { data, error } = await sb.from("docs").select("data").eq("collection", col).eq("id", id).maybeSingle();
        if (error) throw err("permission_denied", error.message);
        const d = data ? data.data || {} : null;
        return { id, exists: !!data, data: () => (d ? structuredClone(d) : undefined) };
      },
      async set(value) {
        const data = clean(value) || {};
        const { error } = await sb.from("docs").upsert({ collection: col, id, data }, { onConflict: "collection,id" });
        if (error) throw err("permission_denied", error.message);
        local(col, id, data);
      },
      async update(patch) {
        const p = clean(patch) || {};
        const { data, error } = await sb.rpc("desk_merge", { p_collection: col, p_id: id, p_patch: p });
        if (error) throw err("permission_denied", error.message);
        if (data == null) throw err("not_found", `No document ${col}/${id}`);
        local(col, id, data);
      },
      async delete() {
        const { error } = await sb.from("docs").delete().eq("collection", col).eq("id", id);
        if (error) throw err("permission_denied", error.message);
        local(col, id, null);
      }
    };
  }
  function collectionRef(col) {
    return {
      id: col, path: col,
      doc: id => docRef(col + "/" + (id || uid())),
      async get() { await loadCol(col); return snapshot(col); },
      onSnapshot(next, error) {
        const o = { next, error };
        (subs[col] = subs[col] || new Set()).add(o);
        listen();
        loadCol(col).then(() => { if (subs[col].has(o)) next(snapshot(col)); }).catch(e => { if (error) error(e); });
        return () => subs[col].delete(o);
      }
    };
  }
  const db = Object.freeze({ doc: docRef, collection: collectionRef });

  /* ---------- user ---------- */
  const user = Object.freeze({
    id: async () => session && session.user.id,
    email: async () => session && session.user.email,
    can: async () => true,
    info: async () => session && { id: session.user.id, email: session.user.email }
  });

  /* ---------- assets: private files at /_blob/<id> ---------- */
  const assets = Object.freeze({
    async upload(blob, opts) {
      if (!blob) throw err("invalid_argument", "Nothing to upload");
      if (blob.size > CFG.maxUpload) throw err("too_large", "Files are limited to 20 MB");
      const id = uid(), contentType = blob.type || "application/octet-stream";
      const { error } = await sb.storage.from(CFG.bucket).upload("_blob/" + id, blob, { contentType, upsert: false, cacheControl: "31536000" });
      if (error) throw err("upload_failed", error.message);
      return { id, url: "/_blob/" + id, sizeBytes: blob.size, contentType, name: blob.name || "" };
    },
    async delete(id) {
      const { error } = await sb.storage.from(CFG.bucket).remove(["_blob/" + String(id).replace(/^\/?_blob\//, "")]);
      if (error) throw err("delete_failed", error.message);
    },
    async list() {
      const out = []; let offset = 0;
      for (;;) {
        const { data, error } = await sb.storage.from(CFG.bucket).list("_blob", { limit: 1000, offset });
        if (error) throw err("permission_denied", error.message);
        data.forEach(f => out.push({ id: f.name, url: "/_blob/" + f.name, sizeBytes: f.metadata && f.metadata.size, contentType: f.metadata && f.metadata.mimetype }));
        if (data.length < 1000) break; offset += 1000;
      }
      return { assets: out, usage: { count: out.length, bytes: out.reduce((a, f) => a + (f.sizeBytes || 0), 0) } };
    }
  });

  /* ---------- job queue: AI (sample) and tool calls (mcp), done by the desk agent ---------- */
  const waiting = new Map(); // job id -> {resolve, reject, label, at}
  let jobsChannel = null, pollTimer = null;
  function finish(row) {
    const w = waiting.get(row.id); if (!w) return;
    if (row.status === "done") { waiting.delete(row.id); w.resolve(row.result); }
    else if (row.status === "error" || row.status === "cancelled") { waiting.delete(row.id); w.reject(err(row.status === "cancelled" ? "cancelled" : "agent_error", row.error || "The desk agent couldn't finish this request")); }
    else return;
    qUi();
  }
  function jobsListen() {
    if (!jobsChannel) jobsChannel = sb.channel("desk-jobs").on("postgres_changes", { event: "UPDATE", schema: "public", table: "jobs" }, p => p.new && finish(p.new)).subscribe();
    if (!pollTimer) pollTimer = setInterval(async () => {
      if (!waiting.size) return;
      const { data } = await sb.from("jobs").select("id,status,result,error").in("id", [...waiting.keys()]);
      (data || []).forEach(finish);
    }, 20000);
  }
  async function queue(kind, payload, label, signal) {
    await opened;
    const id = crypto.randomUUID();
    const { error } = await sb.from("jobs").insert({ id, kind, payload });
    if (error) throw err("queue_failed", error.message);
    jobsListen();
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject, label, at: Date.now() });
      qUi();
      if (signal) {
        const stop = async () => {
          if (!waiting.has(id)) return;
          waiting.delete(id); qUi();
          await sb.from("jobs").update({ status: "cancelled" }).eq("id", id).eq("status", "queued");
          reject(Object.assign(new DOMException("Aborted", "AbortError"), { code: "aborted" }));
        };
        if (signal.aborted) stop(); else signal.addEventListener("abort", stop, { once: true });
      }
    });
  }
  function qUi() {
    let b = document.getElementById("desk-q");
    if (!waiting.size) { if (b) b.remove(); const p = document.getElementById("desk-qp"); if (p) p.remove(); return; }
    if (!b) {
      b = document.createElement("button"); b.id = "desk-q"; b.type = "button";
      b.onclick = () => {
        let p = document.getElementById("desk-qp");
        if (p) { p.remove(); return; }
        p = document.createElement("div"); p.id = "desk-qp"; document.body.appendChild(p); qUi();
      };
      document.body.appendChild(b);
    }
    b.textContent = `⏳ ${waiting.size} waiting for the desk agent`;
    const p = document.getElementById("desk-qp");
    if (p) p.innerHTML = `<b>Queued for the desk agent</b><ul style="padding-left:18px;margin:6px 0">${[...waiting.values()].map(w => `<li>${esc(w.label)} <small>· ${Math.max(1, Math.round((Date.now() - w.at) / 60000))} min</small></li>`).join("")}</ul><small>AI features run through a queue for now; the agent usually answers within a few minutes. You can keep working.</small>`;
  }
  async function stageImages(images) {
    const paths = [];
    for (const [i, blob] of (images || []).entries()) {
      const ext = /png/.test(blob.type) ? "png" : /webp/.test(blob.type) ? "webp" : "jpg";
      const path = `jobs/${new Date().toISOString().slice(0, 10)}/${uid()}-${i + 1}.${ext}`;
      const { error } = await sb.storage.from(CFG.bucket).upload(path, blob, { contentType: blob.type || "image/jpeg" });
      if (error) throw err("upload_failed", error.message);
      paths.push(path);
    }
    return paths;
  }
  function labelFor(input) {
    const t = typeof input === "string" ? input : (input && input.length ? String(input[input.length - 1].content || "") : "");
    return "AI: " + t.replace(/\s+/g, " ").slice(0, 70) + (t.length > 70 ? "…" : "");
  }
  async function ask(mode, input, opts = {}) {
    const images = await stageImages(opts.images);
    const payload = { mode, input, modelTier: opts.modelTier || "default", model: opts.model || null, effort: opts.effort || null, images };
    const r = await queue("ai", payload, labelFor(input), opts.signal);
    if (mode === "json") return r && Object.prototype.hasOwnProperty.call(r, "value") ? r.value : r;
    const text = r && typeof r.text === "string" ? r.text : typeof r === "string" ? r : JSON.stringify(r);
    if (opts.onText) try { opts.onText({ text, delta: text }); } catch (_) {}
    return { text, truncated: !!(r && r.truncated) };
  }
  const sample = (input, opts) => ask("text", input, opts);
  sample.json = (input, opts) => ask("json", input, opts);
  sample.limits = async () => ({ images: { maxCount: 12, maxBytes: 5 * 1024 * 1024 } });
  Object.freeze(sample);

  const TOOL_LABEL = { create_draft: "Gmail draft", dealmachine_enrich_address: "DealMachine lookup", fire_trigger: "Start agent" };
  const mcp = Object.freeze({
    callTool: (server, tool, args) => queue("tool", { server, tool, args: clean(args) || {} }, `${TOOL_LABEL[tool] || tool}${args && (args.full_address || args.subject) ? ": " + String(args.full_address || args.subject).slice(0, 60) : ""}`)
  });

  /* ---------- downloads ---------- */
  const downloads = Object.freeze({
    async save({ filename, data, mimeType } = {}) {
      const blob = data instanceof Blob ? data : new Blob([data == null ? "" : data], { type: mimeType || "application/octet-stream" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename || "download";
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      return { ok: true };
    }
  });

  /* ---------- window.claude ---------- */
  const NS = { db, user, assets, sample, mcp, downloads };
  window.claude = Object.freeze({
    async use(name) {
      if (!(name in NS)) return null; /* "permissions" and anything else: not needed here */
      await opened;
      return NS[name];
    }
  });

  /* ---------- boot ---------- */
  async function boot() {
    addCss();
    await swReady();
    const { data } = await sb.auth.getSession();
    sb.auth.onAuthStateChange((ev, s) => {
      if (ev === "TOKEN_REFRESHED" || ev === "SIGNED_IN") { session = s; saveToken(s); }
      if (ev === "SIGNED_IN" && !allowed) onSession(s);
      if (ev === "SIGNED_OUT") onSession(null);
    });
    await onSession(data.session);
    if (data.session && location.hash.includes("access_token")) history.replaceState(null, "", location.pathname);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true }); else boot();
})();
