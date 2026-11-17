// Deal Desk instant AI.
// The page queues AI requests in public.jobs. This function answers them right away with the
// Anthropic API instead of waiting for the hourly Queue Worker agent.
// - Runs as the signed-in desk user (their token), so the desk's own security rules apply.
// - POST {id} answers one job; POST {} answers every AI job still waiting (up to 8).
// - No ANTHROPIC_API_KEY secret, or Anthropic busy/down -> the job stays queued and the
//   hourly Queue Worker still picks it up, so nothing is ever lost.
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
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: tier === "complex" ? 16000 : 8000,
      system: json ? "Reply with ONLY the JSON that was asked for. No explanations, no code fences." : undefined,
      messages,
    }),
  });
  if (r.status === 429 || r.status >= 500) return { retry: true, why: `Anthropic busy (${r.status})` };
  const out = await r.json();
  if (!r.ok) throw new Error(out?.error?.message || `Anthropic error ${r.status}`);
  const text = (out.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
  const truncated = out.stop_reason === "max_tokens";
  return { result: json ? { value: parseJson(text) } : { text, truncated } };
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { ...CORS,
    "Access-Control-Allow-Headers": req.headers.get("Access-Control-Request-Headers") || CORS["Access-Control-Allow-Headers"],
    "Access-Control-Max-Age": "86400" } });
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return reply({ error: "Sign in first" }, 401);
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return reply({ error: "no_key", note: "Jobs stay queued for the hourly Queue Worker" }, 503);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const body = await req.json().catch(() => ({}));
  // a run that died mid-way (timeout) leaves a job on "working": put it back in line after 10 minutes
  if (!body.id) await sb.from("jobs").update({ status: "queued", started_at: null })
    .eq("kind", "ai").eq("status", "working").lt("started_at", new Date(Date.now() - 600000).toISOString());

  // claim the job(s): queued -> working, so the Queue Worker and other calls skip them
  let q = sb.from("jobs").update({ status: "working", started_at: new Date().toISOString() })
    .eq("kind", "ai").eq("status", "queued");
  q = body.id ? q.eq("id", body.id) : q.in("id",
    ((await sb.from("jobs").select("id").eq("kind", "ai").eq("status", "queued").order("created_at").limit(8)).data || [])
      .map((j: { id: string }) => j.id));
  const { data: jobs, error } = await q.select("id,payload");
  if (error) return reply({ error: error.message }, 403);

  const done = await Promise.all((jobs || []).map(async (job: { id: string; payload: unknown }) => {
    try {
      const a = await answer(sb, key, job);
      if ("retry" in a) {
        await sb.from("jobs").update({ status: "queued", started_at: null }).eq("id", job.id);
        return { id: job.id, status: "queued", why: a.why };
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
