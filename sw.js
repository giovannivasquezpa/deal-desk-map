/* Deal Desk file server.
   The desk stores files (OMs, photos, BOVs) in a private Supabase bucket and links to them as /_blob/<id>.
   This worker answers those links by fetching the file with the signed-in user's token,
   so files open only for someone signed in to the desk on this device. */
const VERSION = "2026-11-16.1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

let auth = null;
self.addEventListener("message", e => { if (e.data && e.data.type === "auth") auth = null; });

function readAuth() {
  return new Promise(res => {
    const r = indexedDB.open("desk-sw", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onerror = () => res(null);
    r.onsuccess = () => {
      try {
        const g = r.result.transaction("kv").objectStore("kv").get("auth");
        g.onsuccess = () => res(g.result || null); g.onerror = () => res(null);
      } catch (_) { res(null); }
    };
  });
}
function page(title, text, status) {
  return new Response(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="font:15px -apple-system,sans-serif;background:#f7f3ea;color:#14213d;display:flex;min-height:90vh;align-items:center;justify-content:center;text-align:center;padding:20px">
<div><h2>${title}</h2><p>${text}</p><p><a href="/">Open the Deal Desk</a></p></div>`, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin || !u.pathname.startsWith("/_blob/")) return;
  e.respondWith((async () => {
    const id = decodeURIComponent(u.pathname.slice("/_blob/".length));
    if (!id || id.includes("..")) return page("Not found", "That file link isn't valid.", 404);
    let a = auth || (auth = await readAuth());
    if (!a || !a.token) return page("Sign in first", "Files on the Deal Desk open only when you're signed in.", 401);
    if (a.exp && a.exp * 1000 < Date.now()) { auth = null; a = await readAuth(); }
    const headers = { Authorization: "Bearer " + a.token, apikey: a.key };
    const range = e.request.headers.get("range"); if (range) headers.Range = range;
    const r = await fetch(`${a.url}/storage/v1/object/authenticated/${a.bucket}/_blob/${encodeURIComponent(id)}`, { headers });
    if (r.status === 400 || r.status === 404) return page("File not found", "This file isn't in the desk's storage (yet).", 404);
    if (r.status === 401 || r.status === 403) { auth = null; return page("Sign in again", "Your desk session expired. Open the desk, then try this file again.", 401); }
    const h = new Headers(r.headers);
    h.set("Cache-Control", "private, max-age=3600");
    h.set("X-Content-Type-Options", "nosniff");
    /* never let a stored file run as a web page on the desk's own address */
    if (e.request.destination !== "image" && /html|xml|javascript/i.test(h.get("content-type") || "")) { h.set("Content-Type", "text/plain; charset=utf-8"); h.set("Content-Disposition", "attachment"); }
    return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
  })());
});
