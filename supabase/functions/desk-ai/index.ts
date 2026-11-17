// Deal Desk instant AI.
// The page queues AI requests in public.jobs. This function answers them right away with the
// Anthropic API instead of waiting for the hourly Queue Worker agent.
// - Runs as the signed-in desk user (their token), so the desk's own security rules apply.
// - POST {id} answers one job; POST {} answers every AI job still waiting (up to 8).
// - No ANTHROPIC_API_KEY secret, or Anthropic busy/down -> the job stays queued and the
//   hourly Queue Worker still picks it up, so nothing is ever lost.
// - Tool jobs it can do instantly: Gmail create_draft (through the Make webhook in config/desk-tools)
//   DealMachine dealmachine_enrich_address (secret DEALMACHINE_API_KEY), and starting a Claude
//   scheduled task through its API trigger (fire_trigger; token per task in TRIGGER_SECRETS below).
//   Also "Deal Desk" save_to_drive: copies a desk file into the property's Google Drive folder (Make webhook).
//   Everything else is left for the Queue Worker.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "https://desk.giovannivasquez.com",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MODELS: Record<string, string> = {
  complex: "claude-sonnet-5-5", // matching, OM Builder, heavier reading
  default: "claude-haiku-5-5",  // address/fact pulls, drafts, everything else (cheapest)
};
const BUCKET = "desk-files";
// Claude scheduled tasks the desk may start instantly -> name of the Supabase secret holding that
// task's API-trigger token (created in claude.ai/code/routines → Edit → Trigger + → API → Generate token)
// The desk names the task it wants (its own trigger id); "fire" is the API-enabled task that actually runs.
const TRIGGER_SECRETS: Record<string, { fire: string; secret: string }> = {
  // BOV button -> "Deal Desk BOV Builder (instant)" (the hourly chat BOV Builder stays as the backup)
  trig_016E2nxBnjy8SnFzGMwNu2Ws: { fire: "trig_01CQ6UFTKgyGK2rvAzECVHdP", secret: "BOV_BUILDER_TOKEN" },
};
const triggerToken = (id: unknown) => (typeof id === "string" && TRIGGER_SECRETS[id] ? (Deno.env.get(TRIGGER_SECRETS[id].secret) || "").replace(/\s+/g, "") : "");

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
}

function b64(buf: ArrayBuffer) {
  let s = ""; const a = new Uint8Array(buf);
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  return btoa(s);
}

function parseJson(text: string) {
  const t = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try { return JSON.parse(t); } catch (_) { /* fall through */ }
  const first = Math.min(...["{", "["].map(c => { const i = t.indexOf(c); return i < 0 ? Infinity : i; }));
  const last = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (first !== Infinity && last > first) return JSON.parse(t.slice(first, last + 1));
  throw new Error("The AI answer wasn't valid JSON");
}

// deno-lint-ignore no-explicit-any
async function answer(sb: any, key: string, job: any) {
  const p = job.payload || {};
  const json = p.mode === "json";
  const tier = p.modelTier === "complex" ? "complex" : "default";
  const model = typeof p.model === "string" && p.model.startsWith("claude-") ? p.model : MODELS[tier];

  // input is either a prompt string or a list of {role, content} messages
  // deno-lint-ignore no-explicit-any
  let messages: any[] = typeof p.input === "string"
    ? [{ role: "user", content: [{ type: "text", text: p.input }] }]
    : (p.input || []).map((m: { role: string; content: unknown }) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content,
      }));
  if (!messages.length) throw new Error("Empty request");

  // pictures were staged in storage by the page; attach them to the last message
  const imgs = [];
  for (const path of (p.images || []) as string[]) {
    const { data, error } = await sb.storage.from(BUCKET).download(path);
    if (error || !data) throw new Error("Couldn't load a picture for this request");
    const type = /png$/i.test(path) ? "image/png" : /webp$/i.test(path) ? "image/webp" : "image/jpeg";
    imgs.push({ type: "image", source: { type: "base64", media_type: type, data: b64(await data.arrayBuffer()) } });
  }
  if (imgs.length) {
    const last = messages[messages.length - 1];
    messages = [...messages.slice(0, -1), { ...last, content: [...imgs, ...last.content] }];
  }

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json",
      // keys made without a workspace must name one: Giovanni's "Default" workspace
      "anthropic-workspace-id": Deno.env.get("ANTHROPIC_WORKSPACE_ID") || "wrkspc_01XmxjkzZwndtiFvCGXoEPbb",
    },
    body: JSON.stringify({
      model,
      max_tokens: tier === "complex" ? 16000 : 8000,
      system: json ? "Reply with ONLY the JSON that was asked for. No explanations, no code fences." : undefined,
      messages,
    }),
  });
  if (r.status === 429 || r.status >= 500) return { retry: true, why: `Anthropic busy (${r.status})` };
  const out = await r.json();
  const msg = out?.error?.message || `Anthropic error ${r.status}`;
  // key, workspace or billing problems are the account's fault, not the job's: leave it in line
  if (r.status === 401 || r.status === 402 || r.status === 403 ||
      /api key|workspace|credit balance|billing|permission/i.test(msg)) return { retry: true, why: msg, account: true };
  if (!r.ok) throw new Error(msg);
  const text = (out.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
  const truncated = out.stop_reason === "max_tokens";
  return { result: json ? { value: parseJson(text) } : { text, truncated } };
}

// deno-lint-ignore no-explicit-any
const asMcp = (data: any) => ({ structuredContent: data, payload: data, content: [{ type: "text", text: JSON.stringify(data) }] });

// deno-lint-ignore no-explicit-any
async function doTool(job: any, cfg: any, sbUser: any) {
  const { server, tool, args = {} } = job.payload || {};
  if (server === "Gmail" && tool === "create_draft") {
    if (!cfg.gmailDraftHook) return { retry: true, why: "Gmail webhook not set up" };
    const to = Array.isArray(args.to) ? args.to : [args.to].filter(Boolean);
    const cc = Array.isArray(args.cc) ? args.cc : args.cc ? [args.cc] : [];
    const r = await fetch(cfg.gmailDraftHook, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: cfg.gmailDraftToken, to, cc, subject: String(args.subject || ""), body: String(args.body || ""), html: !!args.html }),
    });
    const text = await r.text();
    let d; try { d = JSON.parse(text); } catch (_) { d = null; }
    if (!r.ok || !d || !d.id) return { retry: true, why: `Gmail draft didn't go through (${r.status}: ${text.slice(0, 120)})` };
    // same "open this draft" link format Gmail's own tools return
    try {
      const acct = encodeURIComponent(cfg.gmailAccount || "gvasquez@synergyrealtymiami.com");
      d.viewUrl = `https://mail.google.com/mail/?authuser=${acct}#all?compose=thread-f:${BigInt("0x" + d.threadId).toString()}%2Bmsg-a:${d.id}`;
    } catch (_) { /* keep Make's link */ }
    return { result: asMcp(d) };
  }
  if (server === "Deal machine" && tool === "dealmachine_enrich_address") {
    const key = Deno.env.get("DEALMACHINE_API_KEY");
    if (!key) return { retry: true, why: "No DealMachine key yet" };
    const body = { data: [{ full_address: String(args.full_address || "") }], contact_audience: args.contact_audience || "owners" };
    const r = await fetch("https://api.v2.dealmachine.com/v1/enrichment/address", {
      method: "POST", headers: { Authorization: "Bearer " + key, "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => null);
    if (r.status === 429 || r.status >= 500 || r.status === 401 || r.status === 402 || r.status === 403 || !d)
      return { retry: true, why: `DealMachine ${r.status}` };
    if (!r.ok) throw new Error(d?.error?.message || d?.message || `DealMachine error ${r.status}`);
    return { result: asMcp(d) };
  }
  if (server === "Claude Code Remote" && tool === "fire_trigger") {
    const token = triggerToken(args.trigger_id);
    if (!token) return null;
    const r = await fetch(`https://api.anthropic.com/v1/claude_code/routines/${TRIGGER_SECRETS[args.trigger_id].fire}/fire`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token, "anthropic-beta": "experimental-cc-routine-2026-04-01",
        "anthropic-version": "2023-06-01", "content-type": "application/json",
      },
      body: JSON.stringify(args.text ? { text: String(args.text).slice(0, 60000) } : {}),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d) return { retry: true, why: `Couldn't start the agent (${r.status}: ${JSON.stringify(d || {}).slice(0, 160)})` };
    return { result: asMcp(d) };
  }
  if (server === "Deal Desk" && tool === "save_to_drive") {
    // Save a desk file (e.g. an OM Builder OM) into "0- Deal Desk/<Seller Direct | 0-Outside Agents properties>/<folderName>"
    if (!cfg.driveSaveHook) return { retry: true, why: "Drive save not set up" };
    const parentId = args.deal === "broker" ? cfg.brokerListedFolderId : cfg.sellerDirectFolderId;
    const path = "_blob/" + String(args.assetId || "");
    const { data: signed, error } = await sbUser.storage.from(BUCKET).createSignedUrl(path, 900);
    if (error || !signed?.signedUrl) throw new Error("Couldn't find that file on the desk");
    const r = await fetch(cfg.driveSaveHook, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: cfg.gmailDraftToken, parentId, folderName: String(args.folderName || "Untitled property").slice(0, 150),
        fileName: String(args.fileName || "file.pdf").slice(0, 180), fileUrl: signed.signedUrl }),
    });
    const text = await r.text();
    let d; try { d = JSON.parse(text); } catch (_) { d = null; }
    if (!r.ok || !d || !d.fileId) return { retry: true, why: `Drive save didn't go through (${r.status}: ${text.slice(0, 120)})` };
    return { result: asMcp(d) };
  }
  return null; // not something we can do here
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { ...CORS,
    "Access-Control-Allow-Headers": req.headers.get("Access-Control-Request-Headers") || CORS["Access-Control-Allow-Headers"],
    "Access-Control-Max-Age": "86400" } });
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return reply({ error: "Sign in first" }, 401);
  const key = Deno.env.get("ANTHROPIC_API_KEY") || "";

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const body = await req.json().catch(() => ({}));
  // a run that died mid-way (timeout) leaves a job on "working": put it back in line after 10 minutes
  // (AI jobs only; tool jobs on "working" may be the Queue Worker's)
  if (!body.id) await sb.from("jobs").update({ status: "queued", started_at: null })
    .eq("kind", "ai").eq("status", "working").lt("started_at", new Date(Date.now() - 600000).toISOString());

  const cfg = ((await sb.from("docs").select("data").eq("collection", "config").eq("id", "desk-tools").maybeSingle()).data || {}).data || {};
  // deno-lint-ignore no-explicit-any
  const canDo = (j: any) => j.kind === "ai" ? !!key
    : j.kind === "tool" && ((j.payload?.server === "Gmail" && j.payload?.tool === "create_draft" && !!cfg.gmailDraftHook) ||
        (j.payload?.server === "Deal machine" && j.payload?.tool === "dealmachine_enrich_address" && !!Deno.env.get("DEALMACHINE_API_KEY")) ||
        (j.payload?.server === "Claude Code Remote" && j.payload?.tool === "fire_trigger" && !!triggerToken(j.payload?.args?.trigger_id)) ||
        (j.payload?.server === "Deal Desk" && j.payload?.tool === "save_to_drive" && !!cfg.driveSaveHook));

  // pick the waiting jobs we can handle, then claim them: queued -> working, so the Queue Worker skips them
  let pick = sb.from("jobs").select("id,kind,payload").eq("status", "queued");
  pick = body.id ? pick.eq("id", body.id) : pick.order("created_at").limit(12);
  const ids = ((await pick).data || []).filter(canDo).map((j: { id: string }) => j.id);
  if (!ids.length) return reply({ jobs: [], note: key ? undefined : "no_key" });
  const { data: jobs, error } = await sb.from("jobs").update({ status: "working", started_at: new Date().toISOString() })
    .in("id", ids).eq("status", "queued").select("id,kind,payload");
  if (error) return reply({ error: error.message }, 403);

  const done = await Promise.all((jobs || []).map(async (job: { id: string; kind: string; payload: unknown }) => {
    try {
      const a = job.kind === "ai" ? await answer(sb, key, job) : await doTool(job, cfg, sb);
      if (!a) {
        await sb.from("jobs").update({ status: "queued", started_at: null }).eq("id", job.id);
        return { id: job.id, status: "queued", why: "left for the Queue Worker" };
      }
      if ("retry" in a) {
        await sb.from("jobs").update({ status: "queued", started_at: null }).eq("id", job.id);
        return { id: job.id, status: "queued", why: a.why, account: !!(a as { account?: boolean }).account };
      }
      await sb.from("jobs").update({ status: "done", result: a.result, done_at: new Date().toISOString() }).eq("id", job.id);
      return { id: job.id, status: "done" };
    } catch (e) {
      const msg = String((e as Error)?.message || e).slice(0, 500);
      await sb.from("jobs").update({ status: "error", error: msg, done_at: new Date().toISOString() }).eq("id", job.id);
      return { id: job.id, status: "error", error: msg };
    }
  }));
  return reply({ jobs: done });
});
