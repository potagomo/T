/* ============================================================
   kruta-push — ตัวส่งแจ้งเตือน "ใกล้ถึงคาบ" ของแอปครูต้า
   วางโค้ดทั้งไฟล์นี้ใน Cloudflare Worker (ฟรี) — วิธีตั้งค่าอยู่ใน README ของ repo

   ต้องมี:  KV namespace ผูกชื่อตัวแปร  KV
           Cron Trigger  * * * * *   (ทุกนาที)

   ทำงานยังไง
     • แอปส่ง "รายการเตือน" ของ 3 สัปดาห์ข้างหน้ามาเก็บไว้ (เวลาเตือน + ข้อความ)
     • Cron ปลุกตัวนี้ทุกนาที ส่ง Web Push ของรายการที่ถึงเวลาไปทุกเครื่องที่ลงทะเบียน
     • KV อาจใช้เวลาราว 1 นาทีกว่าข้อมูลใหม่จะเห็นได้ จึงไม่ดูแค่นาทีเดียว แต่ส่งรายการที่ถึงเวลาแล้ว
       และยังไม่ได้ส่ง (ย้อนได้ 10 นาที) · จดไว้ใน "sent" ถ้าเผลอส่งซ้ำ แจ้งเตือนมี tag เดียวกันจะทับกันเงียบ ๆ
     • ทุก 5 นาทีจด "beat" ไว้ ให้แอปตรวจได้ว่า Cron ทำงานอยู่จริง
     • กุญแจ VAPID สร้างเองครั้งแรกแล้วเก็บใน KV · รหัสเข้าใช้ (token) มาจากแอปเครื่องแรกที่เชื่อมต่อ
   ไม่มีไลบรารีจากข้างนอก ใช้ WebCrypto ของ Cloudflare ล้วน (RFC 8291 + RFC 8292)
   ============================================================ */

const VERSION = 2;                 // แอปเทียบเลขนี้ ถ้าตัวส่งเก่ากว่าจะบอกให้วางโค้ดใหม่
const CATCH_UP = 10 * 60000;       // รายการที่พลาดไป (KV ยังไม่อัปเดต / cron ข้ามรอบ) ส่งตามได้ภายใน 10 นาที
const MAX_BODY = 256 * 1024;
const MAX_REMINDERS = 600;
const MAX_SUBS = 20;
const SUBJECT = "https://potagomo.github.io/T/lesson/";

const enc = new TextEncoder();
function b64u(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64u(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
  const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; } return out;
}
function same(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });
}

/* ── KV ── */
async function kvGet(env, k, fb) { const v = await env.KV.get(k); if (v == null) return fb; try { return JSON.parse(v); } catch (_) { return fb; } }
const kvPut = (env, k, v) => env.KV.put(k, JSON.stringify(v));

/* ── VAPID (RFC 8292) ── */
async function vapidKeys(env) {
  let v = await kvGet(env, "vapid", null);
  if (!v) {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    v = { jwk: await crypto.subtle.exportKey("jwk", kp.privateKey), pub: b64u(await crypto.subtle.exportKey("raw", kp.publicKey)) };
    await kvPut(env, "vapid", v);
  }
  return v;
}
async function vapidHeader(v, endpoint) {
  const key = await crypto.subtle.importKey("jwk", v.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(head + "." + body));
  return "vapid t=" + head + "." + body + "." + b64u(sig) + ", k=" + v.pub;
}

/* ── payload encryption (RFC 8291, aes128gcm) ── */
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, len * 8));
}
async function encrypt(sub, payload) {
  const uaPub = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const as = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(auth, secret, concat(enc.encode("WebPush: info\0"), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(enc.encode(payload), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);            // record size 4096
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

/* ส่งหนึ่งข้อความไปหนึ่งเครื่อง · คืน "gone" ถ้าเครื่องนั้นยกเลิกไปแล้ว (ลบทิ้งได้) */
async function sendOne(v, sub, msg) {
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Authorization": await vapidHeader(v, sub.endpoint),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "TTL": "900",
      "Urgency": "high"
    },
    body: await encrypt(sub, JSON.stringify(msg))
  });
  if (res.status === 404 || res.status === 410) return "gone";
  return res.ok ? "ok" : "err:" + res.status;
}
async function sendAll(env, msgs) {
  const subs = await kvGet(env, "subs", []);
  if (!subs.length || !msgs.length) return { sent: 0, devices: subs.length };
  const v = await vapidKeys(env);
  let sent = 0; const gone = new Set(), errors = [];
  for (const m of msgs) for (const s of subs) {
    try {
      const r = await sendOne(v, s, m);
      if (r === "ok") sent++; else if (r === "gone") gone.add(s.endpoint); else errors.push(r);
    } catch (e) { errors.push(String(e && e.message || e)); }
  }
  if (gone.size) await kvPut(env, "subs", subs.filter((s) => !gone.has(s.endpoint)));
  return { sent, devices: subs.length - gone.size, errors };
}

/* ── HTTP API (แอปเรียก) ── */
async function body(req) {
  const t = await req.text();
  if (t.length > MAX_BODY) throw new Error("ข้อมูลใหญ่เกินไป");
  return JSON.parse(t || "{}");
}
async function authed(env, b) {
  const tok = await env.KV.get("token");
  return !!tok && typeof b.token === "string" && same(tok, b.token);
}
function cleanSub(s) {
  if (!s || typeof s.endpoint !== "string" || !/^https:\/\//.test(s.endpoint) || !s.keys) return null;
  if (typeof s.keys.p256dh !== "string" || typeof s.keys.auth !== "string") return null;
  return { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
}
function cleanReminders(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_REMINDERS).map((r) => ({
    id: String(r.id || "").slice(0, 200), at: Number(r.at),
    title: String(r.title || "").slice(0, 120), body: String(r.body || "").slice(0, 400)
  })).filter((r) => r.id && isFinite(r.at));
}

async function handle(req, env) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!env.KV) return json({ ok: false, error: "ยังไม่ได้ผูก KV namespace ชื่อตัวแปร KV" }, 500);
  const path = new URL(req.url).pathname.replace(/\/+$/, "") || "/";

  if (req.method === "GET" && path === "/") {
    const v = await vapidKeys(env);
    return json({ ok: true, app: "kruta-push", version: VERSION, claimed: !!(await env.KV.get("token")), publicKey: v.pub });
  }
  if (req.method !== "POST") return json({ ok: false, error: "not found" }, 404);
  let b; try { b = await body(req); } catch (e) { return json({ ok: false, error: "อ่านข้อมูลไม่ได้" }, 400); }

  if (path === "/claim") {
    // เครื่องแรกที่เชื่อมต่อเป็นคนตั้งรหัสเข้าใช้ หลังจากนั้นต้องใช้รหัสเดียวกันเท่านั้น
    if (typeof b.token !== "string" || b.token.length < 32) return json({ ok: false, error: "token สั้นเกินไป" }, 400);
    const tok = await env.KV.get("token");
    if (!tok) await env.KV.put("token", b.token);
    else if (!same(tok, b.token)) return json({ ok: false, error: "ตัวส่งนี้ถูกผูกกับแอปอื่นแล้ว" }, 403);
    return json({ ok: true, publicKey: (await vapidKeys(env)).pub });
  }
  if (!(await authed(env, b))) return json({ ok: false, error: "รหัสเข้าใช้ไม่ถูกต้อง" }, 403);

  if (path === "/subscribe") {
    const s = cleanSub(b.sub); if (!s) return json({ ok: false, error: "subscription ไม่ถูกต้อง" }, 400);
    s.device = String(b.device || "").slice(0, 40); s.at = Date.now();
    const subs = (await kvGet(env, "subs", [])).filter((x) => x.endpoint !== s.endpoint && (!s.device || x.device !== s.device));
    subs.push(s); await kvPut(env, "subs", subs.slice(-MAX_SUBS));
    return json({ ok: true, devices: Math.min(subs.length, MAX_SUBS) });
  }
  if (path === "/unsubscribe") {
    const subs = await kvGet(env, "subs", []);
    await kvPut(env, "subs", subs.filter((x) => x.endpoint !== b.endpoint && (!b.device || x.device !== b.device)));
    return json({ ok: true });
  }
  if (path === "/schedule") {
    const rem = cleanReminders(b.reminders);
    await kvPut(env, "rem", rem);
    return json({ ok: true, count: rem.length });
  }
  if (path === "/status") {
    // สำหรับหน้าตรวจสถานะในแอป — ไม่มีชื่อนักเรียน มีแค่จำนวนและเวลา
    const now = Date.now(), rem = await kvGet(env, "rem", []), subs = await kvGet(env, "subs", []);
    const next = rem.filter((r) => r.at > now).reduce((m, r) => Math.min(m, r.at), Infinity);
    return json({ ok: true, version: VERSION, devices: subs.length, reminders: rem.length, next: isFinite(next) ? next : null,
      beat: Number(await env.KV.get("beat")) || null, lastSent: Number(await env.KV.get("lastSent")) || null, now });
  }
  if (path === "/test") {
    const r = await sendAll(env, [{ title: "🥁 ทดสอบแจ้งเตือน", body: "ถ้าเห็นข้อความนี้ แปลว่าแจ้งเตือนคาบถัดไปพร้อมใช้งานแล้ว", tag: "kruta-test" }]);
    return json({ ok: true, ...r });
  }
  if (path === "/reset") {
    await Promise.all(["token", "subs", "rem", "sent"].map((k) => env.KV.delete(k)));
    return json({ ok: true });
  }
  return json({ ok: false, error: "not found" }, 404);
}

/* ── Cron: ทุกนาที ส่งรายการที่ถึงเวลาแล้วและยังไม่ได้ส่ง ── */
async function tick(env, scheduledTime) {
  if (!env.KV) return { sent: 0 };
  const minute = Math.floor(scheduledTime / 60000) * 60000, end = minute + 60000;
  if ((minute / 60000) % 5 === 0) await env.KV.put("beat", String(scheduledTime));
  const rem = await kvGet(env, "rem", []);
  const cand = rem.filter((r) => r.at < end && r.at >= minute - CATCH_UP);
  if (!cand.length) return { sent: 0 };
  const sent = await kvGet(env, "sent", {});
  const key = (r) => r.id + "@" + r.at;                // เปลี่ยนเวลาคาบ = รายการใหม่ ส่งได้อีกครั้ง
  const due = cand.filter((r) => !sent[key(r)]);
  if (!due.length) return { sent: 0 };
  due.forEach((r) => { sent[key(r)] = scheduledTime; });
  Object.keys(sent).forEach((k) => { if (sent[k] < scheduledTime - 2 * 86400000) delete sent[k]; });
  await kvPut(env, "sent", sent);                       // จดก่อนส่ง กันรอบถัดไปส่งซ้ำระหว่างที่รอบนี้ยังส่งไม่เสร็จ
  await env.KV.put("lastSent", String(scheduledTime));
  return sendAll(env, due.map((r) => ({ title: r.title, body: r.body, tag: "kruta-" + r.id })));
}

export default {
  fetch(req, env) { return handle(req, env).catch((e) => json({ ok: false, error: String(e && e.message || e) }, 500)); },
  scheduled(event, env, ctx) { ctx.waitUntil(tick(env, event.scheduledTime)); }
};
