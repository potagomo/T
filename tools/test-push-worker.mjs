#!/usr/bin/env node
/* ทดสอบตัวส่งแจ้งเตือน push-worker/worker.js โดยไม่ต้องขึ้น Cloudflare
 *
 *   npm i http_ece && node tools/test-push-worker.mjs
 *
 * จำลอง KV กับปลายทาง push แล้วตรวจว่า
 *   ตั้งรหัสเข้าใช้ได้ครั้งเดียว · รหัสผิดถูกปฏิเสธ
 *   ข้อความที่ส่งถอดรหัสได้ด้วยไลบรารีมาตรฐาน (http_ece, RFC 8188/8291) และได้ข้อความตรงกัน
 *   ลายเซ็น VAPID ตรวจผ่านด้วย node:crypto
 *   Cron ส่งรายการที่ถึงเวลา · ส่งตามได้ถ้า KV อัปเดตช้า · ไม่ส่งซ้ำ · เครื่องที่ยกเลิกแล้ว (410) ถูกลบออก
 */
import { createRequire } from "node:module";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const ece = require("http_ece");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const worker = (await import(pathToFileURL(path.join(ROOT, "push-worker/worker.js")).href)).default;

const fail = [];
const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fail.push(m); };

const store = new Map();
const env = { KV: { get: async (k) => store.has(k) ? store.get(k) : null, put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); } } };
const call = async (p, b) => (await worker.fetch(new Request("https://kruta-push.test" + p, b === undefined ? {} : { method: "POST", body: JSON.stringify(b) }), env)).json();

// ปลายทาง push จำลอง: เก็บคำขอไว้ตรวจ
const pushed = []; let gone = new Set();
globalThis.fetch = async (url, init) => {
  pushed.push({ url, headers: init.headers, body: Buffer.from(init.body) });
  return new Response(null, { status: gone.has(url) ? 410 : 201 });
};

console.log("ตัวส่งแจ้งเตือน (push-worker)");
const info = await call("/");
ok(info.ok && !info.claimed && /^[A-Za-z0-9_-]{87}$/.test(info.publicKey), "เปิดครั้งแรก: สร้างกุญแจ VAPID ให้เอง");
const token = crypto.randomBytes(32).toString("base64url");
ok((await call("/claim", { token })).ok, "เครื่องแรกตั้งรหัสเข้าใช้ได้");
ok(!(await call("/claim", { token: crypto.randomBytes(32).toString("base64url") })).ok, "คนอื่นมาตั้งรหัสทับไม่ได้");
ok(!(await call("/schedule", { token: "ผิด", reminders: [] })).ok, "รหัสผิดเรียกใช้ไม่ได้");

// เครื่องผู้ใช้จำลอง: กุญแจ ECDH จริงแบบที่เบราว์เซอร์สร้าง
const ua = crypto.createECDH("prime256v1"); ua.generateKeys();
const auth = crypto.randomBytes(16);
const sub = { endpoint: "https://web.push.apple.com/QAbc123", keys: { p256dh: ua.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } };
ok((await call("/subscribe", { token, sub, device: "ipad1" })).ok, "ลงทะเบียนเครื่องได้");
const sub2 = { endpoint: "https://fcm.googleapis.com/fcm/send/xyz", keys: sub.keys };
await call("/subscribe", { token, sub: sub2, device: "phone1" });

const minute = Math.floor(Date.now() / 60000) * 60000 + 5 * 60000;
const r = await call("/schedule", { token, reminders: [
  { id: "a", at: minute, title: "🥁 คาบถัดไป 17:00 · อีก 30 นาที", body: "น้องมิ้น · ส่วนตัว" },
  { id: "b", at: minute + 60000, title: "ถัดไปอีกนาที", body: "x" } ] });
ok(r.ok && r.count === 2, "รับรายการเตือนได้");

pushed.length = 0;
await new Promise((res) => worker.scheduled({ scheduledTime: minute - 60000 }, env, { waitUntil: (p) => p.then(res) }));
ok(pushed.length === 0, "นาทีก่อนถึงเวลา: ยังไม่ส่ง");
await new Promise((res) => worker.scheduled({ scheduledTime: minute }, env, { waitUntil: (p) => p.then(res) }));
ok(pushed.length === 2, "ถึงเวลา: ส่งรายการนั้นไปทั้ง 2 เครื่อง (ส่ง " + pushed.length + ")");
const msg = pushed.find((p) => p.url === sub.endpoint);
const plain = ece.decrypt(msg.body, { version: "aes128gcm", privateKey: ua, authSecret: auth.toString("base64url") });
const m = JSON.parse(plain.toString("utf8"));
ok(m.title === "🥁 คาบถัดไป 17:00 · อีก 30 นาที" && m.body === "น้องมิ้น · ส่วนตัว" && m.tag === "kruta-a", "ถอดรหัสด้วยไลบรารีมาตรฐานได้ ข้อความตรง (ภาษาไทย/อีโมจิครบ)");
ok(msg.headers["Content-Encoding"] === "aes128gcm" && msg.headers.TTL && msg.headers.Urgency === "high", "หัวข้อคำขอครบตามมาตรฐาน");

const [, t, k] = /^vapid t=([^,]+), k=(.+)$/.exec(msg.headers.Authorization) || [];
const [h, c, s] = t.split(".");
const claims = JSON.parse(Buffer.from(c, "base64url"));
const pub = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: Buffer.from(k, "base64url").subarray(1, 33).toString("base64url"), y: Buffer.from(k, "base64url").subarray(33).toString("base64url") }, format: "jwk" });
const sigOk = crypto.verify("sha256", Buffer.from(h + "." + c), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
ok(sigOk && claims.aud === "https://web.push.apple.com" && claims.exp > Date.now() / 1000 && /^https:/.test(claims.sub) && k === info.publicKey, "ลายเซ็น VAPID ถูกต้อง (aud/exp/sub ครบ)");

pushed.length = 0;
await new Promise((res) => worker.scheduled({ scheduledTime: minute }, env, { waitUntil: (p) => p.then(res) }));
ok(pushed.length === 0, "cron รอบเดิมซ้ำ (เช่นรันใหม่): ไม่ส่งซ้ำ");
pushed.length = 0;
await new Promise((res) => worker.scheduled({ scheduledTime: minute + 60000 }, env, { waitUntil: (p) => p.then(res) }));
ok(pushed.length === 2 && pushed.every((p) => !/คาบถัดไป 17:00/.test(p.body)), "นาทีถัดไปส่งรายการถัดไป ไม่ส่งของเก่าซ้ำ");

// เคสจริง: สร้างคาบก่อนเวลาเตือนแค่นาทีเดียว แล้ว KV ยังเห็นรายการเก่าในรอบนั้น
const tk = (t) => new Promise((res) => worker.scheduled({ scheduledTime: t }, env, { waitUntil: (p) => p.then(res) }));
const late = minute + 10 * 60000;
const fresh = [{ id: "late", at: late, title: "🥁 อีก 10 นาที · 04:19 นามิ", body: "โรงเรียน" }];
const staleRem = store.get("rem");                   // รอบ cron ตอนถึงเวลาเห็นของเก่า
pushed.length = 0; await tk(late);
ok(pushed.length === 0, "รอบที่ KV ยังไม่อัปเดต: ยังไม่มีรายการให้ส่ง");
await call("/schedule", { token, reminders: fresh });
pushed.length = 0; await tk(late + 60000);
ok(pushed.length === 2 && pushed.every((p) => !p.body.includes("ทดสอบ")), "รอบถัดไปเห็นรายการแล้ว: ส่งตามทันที (ช้าไม่เกินนาทีเดียว)");
pushed.length = 0; await tk(late + 120000);
ok(pushed.length === 0, "รอบต่อไปไม่ส่งซ้ำ");
await call("/schedule", { token, reminders: [{ id: "old", at: late + 120000 - 11 * 60000, title: "เก่า", body: "" }] });
pushed.length = 0; await tk(late + 120000);
ok(pushed.length === 0, "รายการที่เลยมาเกิน 10 นาที ไม่ส่ง (กันเด้งเตือนคาบที่ผ่านไปแล้ว)");
void staleRem;

const st = await call("/status", { token });
ok(st.ok && st.version === 3 && st.devices === 2 && st.reminders === 1 && typeof st.now === "number", "หน้าตรวจสถานะ: รุ่น อุปกรณ์ จำนวนรายการ");
const beatMin = Math.ceil(Date.now() / 300000) * 300000;
await tk(beatMin);
ok(Number(store.get("beat")) === beatMin, "ทุก 5 นาทีจดว่า Cron ทำงาน (ให้แอปตรวจได้)");
ok(!(await call("/status", { token: "ผิด" })).ok, "หน้าตรวจสถานะต้องใช้รหัสเข้าใช้");

// วิดเจ็ต: อ่านได้ด้วยรหัสวิดเจ็ตเท่านั้น และอ่านได้อย่างเดียว
const wkey = crypto.randomBytes(24).toString("base64url");
ok((await call("/widget-data", { token, wkey, lessons: [{ d: "2026-10-08", t: "16:00", m: 50, n: "harvey", k: "school", p: "PlaySound", s: "planned" }] })).ok, "วิดเจ็ต: แอปส่งตารางขึ้นได้");
ok(!(await call("/widget-data", { token: "ผิด", wkey, lessons: [] })).ok, "วิดเจ็ต: ส่งตารางต้องใช้รหัสเข้าใช้");
const wget = async (k) => (await worker.fetch(new Request("https://kruta-push.test/widget?k=" + encodeURIComponent(k)), env)).json();
const w = await wget(wkey);
ok(w.ok && w.lessons.length === 1 && w.lessons[0].n === "harvey" && w.lessons[0].m === 50, "วิดเจ็ต: อ่านตารางด้วยรหัสวิดเจ็ตได้");
ok(!(await wget("ผิด")).ok && !(await wget(token)).ok, "วิดเจ็ต: รหัสผิด หรือใช้รหัสเข้าใช้แทน อ่านไม่ได้");

gone = new Set([sub2.endpoint]); pushed.length = 0;
const tr = await call("/test", { token });
ok(tr.ok && tr.sent === 1 && tr.devices === 1, "ปุ่มทดสอบส่งได้ · เครื่องที่ยกเลิกแล้ว (410) ถูกลบออกเอง");
ok(JSON.parse(store.get("subs")).length === 1, "เหลือ 1 เครื่องในรายชื่อ");

console.log(fail.length ? "\n✗ ไม่ผ่าน " + fail.length + " ข้อ" : "\n✓ ผ่านทั้งหมด");
process.exit(fail.length ? 1 : 0);
