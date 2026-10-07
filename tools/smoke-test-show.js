#!/usr/bin/env node
/* ตรวจแอป "อัดโชว์" (/show/) กับ Google Drive จำลอง ด้วยเบราว์เซอร์จริงและกล้องจำลอง
 *
 *   npm i playwright && node tools/smoke-test-show.js
 *
 * Drive จำลองทำตามกติกาของจริง: resumable upload ต้องส่งต่อจากไบต์ที่ได้แล้ว ก้อนกลางทางต้องเป็นพหุคูณ 256 KB
 * ตรวจว่า
 *   เชื่อมต่อแล้วได้โฟลเดอร์ "อัดโชว์" · เซ็ตลิสต์ขึ้นไปเป็นไฟล์
 *   อัดอยู่ วิดีโอขึ้นไปตามทีละก้อน (ก่อนกดหยุด) · Drive ล่มกลางทางแล้วส่งต่อได้ ไม่ซ้ำไม่ขาด
 *   กดหยุดแล้ว ไฟล์บน Drive ตรงกับวิดีโอในเครื่องทุกไบต์ · ชื่อไฟล์และคำอธิบายมีรายชื่อเพลง · .json มีมาร์กครบ
 *   บัตรหมดอายุกลางโชว์ วิดีโอยังส่งต่อได้ (ไม่แนบบัตร) · รีโหลดกลางการอัด ส่วนที่ 1 และ 2 ขึ้นครบทั้งคู่
 *   ลบโชว์ออกจากแอป ไฟล์บน Drive ยังอยู่
 *
 * ออก 0 = ผ่าน, 1 = ไม่ผ่าน
 */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, ".."), PREFIX = "/T/";
const fail = [];
const ok = (c, msg) => { console.log((c ? "  ✓ " : "  ✗ ") + msg); if (!c) fail.push(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

function chromiumPath() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  try {
    const d = fs.readdirSync(base).filter((e) => /^chromium-\d+$/.test(e)).sort().pop();
    const p = d && path.join(base, d, "chrome-linux", "chrome");
    return p && fs.existsSync(p) ? p : undefined;
  } catch (_) { return undefined; }
}

const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split("?")[0]);
  if (!u.startsWith(PREFIX)) { res.writeHead(404); return res.end(); }
  let rel = u.slice(PREFIX.length);
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const f = path.join(ROOT, rel);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("404"); }
  res.writeHead(200, { "Content-Type": f.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});

/* ---------- Google Drive จำลอง ---------- */
const Q = 256 * 1024;
const files = new Map(), uploads = new Map();
let nextId = 1, failPuts = 0, putNoAuth = 0, puts = 0, badPieces = 0;
const validTok = (h) => /^Bearer tok\d+$/.test(h || "");
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "Location, Range",
               "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS" };
const json = (route, status, obj, extra) => route.fulfill({ status, headers: Object.assign({ "Content-Type": "application/json" }, CORS, extra || {}), body: obj == null ? "" : JSON.stringify(obj) });
function newFile(meta, data) {
  const id = "f" + nextId++;
  files.set(id, { id, name: meta.name, mimeType: meta.mimeType || "", parents: meta.parents || [], description: meta.description || "", data: data || Buffer.alloc(0) });
  return id;
}
function parseMultipart(req) {
  const b = (req.headers()["content-type"] || "").match(/boundary=(\S+)/)[1];
  const parts = req.postDataBuffer().toString("utf8").split("--" + b).slice(1, -1).map((p) => p.split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n$/, ""));
  return { meta: JSON.parse(parts[0]), data: Buffer.from(parts[1], "utf8") };
}
async function drive(route) {
  const req = route.request(), url = new URL(req.url()), m = req.method(), h = req.headers();
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
  const p = url.pathname;

  // ส่งต่อเข้าช่อง resumable (ไม่บังคับบัตร เหมือนของจริงที่ใช้ upload_id ยืนยันตัว)
  if (m === "PUT" && url.searchParams.get("upload_id")) {
    const up = uploads.get(url.searchParams.get("upload_id"));
    if (!up) return json(route, 404, { error: { message: "no session" } });
    puts++;
    if (!h.authorization) putNoAuth++;
    if (failPuts > 0) { failPuts--; return json(route, 503, { error: { message: "backend error" } }); }
    const cr = h["content-range"] || "", body = req.postDataBuffer() || Buffer.alloc(0);
    const rangeHdr = () => (up.got ? { Range: "bytes=0-" + (up.got - 1) } : {});
    let mm;
    if ((mm = cr.match(/^bytes \*\/(\*|\d+)$/))) {
      if (mm[1] !== "*" && Number(mm[1]) === up.got) return finish(route, up);
      return json(route, 308, null, rangeHdr());
    }
    mm = cr.match(/^bytes (\d+)-(\d+)\/(\*|\d+)$/);
    if (!mm) return json(route, 400, { error: { message: "bad range" } });
    const a = +mm[1], b = +mm[2], total = mm[3] === "*" ? null : +mm[3];
    if (b - a + 1 !== body.length) return json(route, 400, { error: { message: "length mismatch" } });
    if (a !== up.got) return json(route, 308, null, rangeHdr());
    const final = total != null && b + 1 === total;
    if (!final && body.length % Q) { badPieces++; return json(route, 400, { error: { message: "not 256K multiple" } }); }
    up.chunks.push(body); up.got += body.length;
    if (final) return finish(route, up);
    return json(route, 308, null, rangeHdr());
  }
  if (!validTok(h.authorization)) return json(route, 401, { error: { message: "auth" } });

  if (m === "POST" && p === "/upload/drive/v3/files" && url.searchParams.get("uploadType") === "resumable") {
    const id = "u" + nextId++;
    uploads.set(id, { meta: JSON.parse(req.postData()), chunks: [], got: 0 });
    return json(route, 200, null, { Location: "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=" + id });
  }
  if (p === "/upload/drive/v3/files" && m === "POST") { const { meta, data } = parseMultipart(req); return json(route, 200, { id: newFile(meta, data) }); }
  let mm = p.match(/^\/upload\/drive\/v3\/files\/(\w+)$/);
  if (mm && m === "PATCH") {
    const f = files.get(mm[1]); if (!f) return json(route, 404, { error: { message: "nf" } });
    const { meta, data } = parseMultipart(req); if (meta.name) f.name = meta.name; f.data = data;
    return json(route, 200, { id: f.id });
  }
  if (p === "/drive/v3/about") return json(route, 200, { user: { emailAddress: "show@test" }, storageQuota: { limit: "16106127360", usage: "1000" } });
  if (p === "/drive/v3/files" && m === "POST") return json(route, 200, { id: newFile(JSON.parse(req.postData())) });
  if (p === "/drive/v3/files" && m === "GET") {
    const q = url.searchParams.get("q") || "";
    const name = (q.match(/name='((?:[^'\\]|\\.)*)'/) || [])[1], parent = (q.match(/'(\w+)' in parents/) || [])[1];
    const mime = (q.match(/mimeType='([^']*)'/) || [])[1];
    const out = [...files.values()].filter((f) => (!name || f.name === name) && (!parent || f.parents.includes(parent)) && (!mime || f.mimeType === mime));
    return json(route, 200, { files: out.slice(0, 1).map((f) => ({ id: f.id })) });
  }
  mm = p.match(/^\/drive\/v3\/files\/(\w+)$/);
  if (mm) {
    const f = files.get(mm[1]); if (!f) return json(route, 404, { error: { message: "nf" } });
    if (m === "GET") return route.fulfill({ status: 200, headers: Object.assign({ "Content-Type": "application/json" }, CORS), body: f.data });
    if (m === "PATCH") { const b = JSON.parse(req.postData()); Object.assign(f, b); return json(route, 200, { id: f.id }); }
  }
  return json(route, 400, { error: { message: "unhandled " + m + " " + p } });
}
function finish(route, up) {
  const id = newFile(up.meta, Buffer.concat(up.chunks));
  up.fileId = id;
  return json(route, 200, { id });
}
const GIS = `window.google = { accounts: { oauth2: {
  initTokenClient: function (cfg) { return { requestAccessToken: function () {
    window.__gisCalls = (window.__gisCalls || 0) + 1;
    setTimeout(function () { cfg.callback({ access_token: "tok" + window.__gisCalls, expires_in: 3599, scope: cfg.scope }); }, 30);
  } }; },
  hasGrantedAllScopes: function () { return true; }, revoke: function (t, cb) { cb && cb(); } } } };`;

const byName = (re) => [...files.values()].filter((f) => re.test(f.name));
async function until(fn, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch (_) {} await sleep(250); }
  console.log("    (หมดเวลารอ: " + what + ")");
  return false;
}

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port + PREFIX + "show/";
  const browser = await chromium.launch({ executablePath: chromiumPath(),
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, permissions: ["camera", "microphone"] });
  await ctx.addInitScript(() => { window.__drivePiece = 256 * 1024; });
  await ctx.route("https://www.googleapis.com/**", drive);
  await ctx.route("https://accounts.google.com/gsi/client", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: GIS }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("dialog", (d) => d.accept());

  console.log("อัดโชว์ + Google Drive จำลอง");
  await page.goto(base);
  ok(await page.evaluate(() => window.__drive && typeof window.__drive === "object"), "ชั้น Drive โหลดครบ (" + (await page.evaluate(() => typeof window.__drive === "string" ? window.__drive : "ok")) + ")");
  ok(/ตั้งค่า Google Drive/.test(await page.textContent("#drvCard")), "หน้าแรกมีการ์ด Google Drive");
  const fmt = await page.evaluate(() => (curFormat() || {}).id);
  console.log("    ชนิดไฟล์ที่เบราว์เซอร์นี้อัดได้: " + fmt);

  // เชื่อมต่อ
  await page.click("#drvCard [data-a=setup]");
  await page.fill("#drvId", "123-test.apps.googleusercontent.com");
  await until(() => page.evaluate(() => !!window.google), 5000, "GIS");
  await page.click("#drvGo");
  ok(await until(async () => /เชื่อมต่อแล้ว/.test(await page.textContent("#drvMsg")), 8000, "เชื่อมต่อ"), "เชื่อมต่อ Drive สำเร็จ");
  ok(byName(/^อัดโชว์$/).length === 1, "สร้างโฟลเดอร์ \"อัดโชว์\" ใน Drive");
  await page.click("#drvClose");

  // เซ็ตลิสต์
  await page.fill("#setlist", "เพลงเปิด\nเพลงช้า\nเพลงปิด");
  ok(await until(() => { const f = byName(/^เซ็ตลิสต์\.json$/)[0]; return f && /เพลงช้า/.test(f.data.toString()); }, 10000, "เซ็ตลิสต์"), "เซ็ตลิสต์ขึ้น Drive");

  // โชว์ที่ 1: อัด มาร์กเพลง Drive ล่มกลางทาง แล้วหยุด
  await page.click("#openCam");
  await page.waitForSelector("#cam:not([hidden])");
  await sleep(1500);
  await page.click("#bRec");
  await sleep(4000);
  await page.click("#bNext");
  ok(await until(() => puts >= 2, 15000, "ส่งระหว่างอัด"), "ระหว่างอัด วิดีโอขึ้น Drive ตามไปแล้ว (" + puts + " ก้อน ก่อนกดหยุด)");
  failPuts = 2;
  await sleep(6000);
  await page.click("#bNext");
  ok(/Drive/.test(await page.textContent("#stats")), "จอกล้องบอกสถานะ Drive: " + (await page.textContent("#stats")).match(/Drive[^]*$/)[0]);
  await sleep(3000);
  await page.click("#bStop"); await page.click("#bStop");
  await page.waitForSelector("#detail:not([hidden])", { timeout: 15000 });
  await page.fill("#dTitle", "ร้านทดสอบ"); await page.dispatchEvent("#dTitle", "change");
  const sid1 = await page.evaluate(() => cur.id);
  ok(await until(() => page.evaluate((id) => !!(__drive.D.files[id] && __drive.D.files[id].done), sid1), 40000, "ส่งครบ"), "หยุดอัดแล้ว ส่งวิดีโอครบ");
  const local1 = await page.evaluate(async (id) => {
    const rows = await tx("chunks", "readonly", (s) => s.getAll(sesRange(id)));
    const buf = new Uint8Array(await new Blob(rows.map((r) => r.blob)).arrayBuffer());
    const h = await crypto.subtle.digest("SHA-256", buf);
    return { n: buf.length, h: Array.from(new Uint8Array(h)).map((x) => x.toString(16).padStart(2, "0")).join("") };
  }, sid1);
  const vid1 = files.get(await page.evaluate((id) => __drive.D.files[id].vid, sid1));
  ok(vid1 && vid1.data.length === local1.n && sha(vid1.data) === local1.h, "ไฟล์บน Drive ตรงกับวิดีโอในเครื่องทุกไบต์ (" + local1.n + " ไบต์ แม้ Drive ล่ม 2 ครั้ง)");
  ok(badPieces === 0, "ก้อนกลางทางเป็นพหุคูณ 256 KB ทุกก้อน");
  ok(await until(() => vid1 && /ร้านทดสอบ/.test(vid1.name) && /เพลงเปิด/.test(vid1.description) && /เพลงช้า/.test(vid1.description), 15000, "ชื่อ/คำอธิบาย"),
     "ชื่อไฟล์บน Drive ตามชื่อโชว์ และคำอธิบายมีรายชื่อเพลงพร้อมเวลา (" + (vid1 && vid1.name) + ")");
  const meta1 = byName(/ร้านทดสอบ.*\.json$/)[0];
  const mj = meta1 && JSON.parse(meta1.data.toString());
  ok(mj && mj.marks.filter((m) => m.type === "song").map((m) => m.name).join(",") === "เพลงเปิด,เพลงช้า", "ไฟล์ .json มีมาร์กเพลงครบ");
  ok(/ครบแล้ว/.test(await page.textContent("#drvBox")), "หน้ารายละเอียดบอกว่าอยู่บน Drive ครบแล้ว");

  // โชว์ที่ 2: บัตรหมดอายุกลางโชว์ แล้วรีโหลดหน้ากลางการอัด
  await page.click("#dBack");
  await page.click("#openCam");
  await page.waitForSelector("#cam:not([hidden])");
  await sleep(1500);
  await page.click("#bRec");
  await sleep(3000);
  const sid2 = await page.evaluate(() => ses.id);
  ok(await until(() => page.evaluate((id) => !!(__drive.D.files[id] && __drive.D.files[id].uri), sid2), 8000, "เปิดช่องส่ง"), "เริ่มอัดแล้วเปิดช่องส่งวิดีโอทันที");
  await page.evaluate(() => __drive.expire());
  const na0 = putNoAuth;
  ok(await until(() => putNoAuth > na0, 15000, "ส่งไม่แนบบัตร"), "บัตรหมดอายุกลางโชว์ วิดีโอยังส่งต่อได้");
  await page.reload();
  ok(await until(() => page.evaluate(() => !!(typeof ses !== "undefined" && ses && ses.part === 2)), 15000, "อัดต่อ"), "รีโหลดกลางการอัด แอปอัดต่อเป็นส่วนที่ 2");
  await sleep(4000);
  await page.click("#bStop"); await page.click("#bStop");
  await page.waitForSelector("#detail:not([hidden])", { timeout: 15000 });
  const sid3 = await page.evaluate(() => cur.id);
  ok(await until(() => page.evaluate((id) => !!(__drive.D.files[id] && __drive.D.files[id].done), sid2), 30000, "ส่วนที่ 1 ส่งครบ"), "ส่วนที่ 1 (ถูกรีโหลดตัด) ส่งครบ");
  const p3 = await page.evaluate((id) => __drive.D.files[id] || null, sid3);
  ok(p3 && !p3.done && !p3.uri, "ส่วนที่ 2 รอเชื่อมต่อใหม่ (บัตรหมดอายุ เปิดช่องส่งใหม่ไม่ได้ ไม่เด้งหน้าล็อกอินเอง)");
  ok(/เชื่อมต่อ/.test(await page.textContent("#drvBox")), "หน้ารายละเอียดมีปุ่มเชื่อมต่อใหม่");
  await page.click("#drvBox [data-a=auth]");
  ok(await until(() => page.evaluate((id) => !!(__drive.D.files[id] && __drive.D.files[id].done), sid3), 30000, "ส่วนที่ 2 ส่งครบ"), "แตะเชื่อมต่อแล้ว ส่วนที่ 2 ส่งครบ");
  for (const id of [sid2, sid3]) {
    const l = await page.evaluate(async (id) => {
      const rows = await tx("chunks", "readonly", (s) => s.getAll(sesRange(id)));
      const buf = new Uint8Array(await new Blob(rows.map((r) => r.blob)).arrayBuffer());
      return { n: buf.length, h: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf))).map((x) => x.toString(16).padStart(2, "0")).join("") };
    }, id);
    const f = files.get(await page.evaluate((id) => __drive.D.files[id].vid, id));
    ok(f && sha(f.data) === l.h, "ส่วนที่ " + (id === sid2 ? 1 : 2) + " บน Drive ตรงกับในเครื่อง (" + l.n + " ไบต์) ชื่อ " + (f && f.name));
  }

  // ลบโชว์ออกจากแอป ไฟล์บน Drive ยังอยู่
  await page.click("#dDel");
  await page.waitForSelector("#home:not([hidden])");
  ok(files.has(vid1.id) && files.size >= 6, "ลบโชว์ออกจากแอปแล้ว ไฟล์บน Drive ยังอยู่");
  ok(await until(async () => /อยู่บน Drive แล้ว/.test(await page.textContent("#lib")), 6000, "ป้ายในคลัง"), "คลังวิดีโอขึ้นป้าย \"อยู่บน Drive แล้ว\"");
  ok(!errs.length, "ไม่มี error ในหน้า" + (errs.length ? ": " + errs.join(" | ") : ""));

  await browser.close(); server.close();
  console.log(fail.length ? "\n✗ ไม่ผ่าน " + fail.length + " ข้อ" : "\n✓ ผ่านทุกข้อ");
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
