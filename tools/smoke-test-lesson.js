#!/usr/bin/env node
/* ตรวจแอป "ครูต้า — บันทึกการสอน" (/lesson/) ด้วยเบราว์เซอร์จริง
 *
 *   npm i playwright http_ece && node tools/smoke-test-lesson.js
 *
 * เสิร์ฟโปรเจกต์ใต้ /T/ เลียนแบบ GitHub Pages แล้วตรวจว่า
 *   เปิดขึ้นทั้งจอ iPad และจอมือถือ · manifest/ไอคอนโหลดได้ (ติดตั้งลงหน้าโฮมได้)
 *   Service Worker ของ /lesson/ ทำงาน · ตัดเน็ตแล้วยังเปิดได้
 *   Service Worker ของกลอง → MIDI ไม่เก็บหน้า /lesson/ ไปทับสำเนาของตัวเอง
 *   โหมดกลางคืน: ตัวหนังสืออ่านออกทุกชิ้น สลับกลับได้ครบ
 *   ล็อกหน้าจอเก็บรหัสแบบ PBKDF2 · รหัสแบบเก่ายังเข้าได้และถูกอัปเกรด
 *   ซิงค์สองเครื่องแบบเรียลไทม์ · ลบนักเรียนข้ามเครื่อง
 *   แจ้งเตือนคาบถัดไป: ตัวส่งจริง (push-worker) + KV จำลอง ถอดรหัสข้อความด้วย http_ece (ใช้คลาวด์จำลองแทน Firebase ผ่านช่อง
 *   window.__syncTransportFactory ที่แอปเปิดไว้ให้ทดสอบ)
 *
 * ออก 0 = ผ่าน, 1 = ไม่ผ่าน
 */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium, devices } = require("playwright");

const ROOT = path.resolve(__dirname, ".."), PREFIX = "/T/";
const MIME = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8", ".webmanifest":"application/manifest+json",
  ".png":"image/png", ".woff2":"font/woff2" };
const fail = [];
const ok = (c, msg) => { console.log((c ? "  ✓ " : "  ✗ ") + msg); if (!c) fail.push(msg); };

function chromiumPath() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  try {
    const d = fs.readdirSync(base).filter((e) => /^chromium-\d+$/.test(e)).sort().pop();
    const p = d && path.join(base, d, "chrome-linux", "chrome");
    return p && fs.existsSync(p) ? p : undefined;
  } catch (_) { return undefined; }
}

/* ตัวส่งแจ้งเตือน (push-worker/worker.js ตัวจริง) เสียบไว้ที่ /T/push ใช้ KV จำลอง */
let WORKER = null;
const kv = new Map();
const WENV = { KV: { get: async (k) => kv.has(k) ? kv.get(k) : null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } } };
const pushed = [];                       // ข้อความที่ตัวส่งยิงออกไปหาเครื่อง
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes("/pushsvc/")) { pushed.push({ url: String(url), body: Buffer.from(init.body) }); return new Response(null, { status: 201 }); }
  return realFetch(url, init);
};
function serveWorker(req, res, rest) {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const init = { method: req.method, headers: req.headers };
    if (req.method !== "GET" && req.method !== "HEAD") init.body = Buffer.concat(chunks);
    const r = await WORKER.fetch(new Request("http://worker.test" + (rest || "/"), init), WENV);
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  });
}

const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split("?")[0]);
  if (u === PREFIX + "push" || u.startsWith(PREFIX + "push/")) {
    const q = req.url.indexOf("?");
    return serveWorker(req, res, u.slice((PREFIX + "push").length) + (q >= 0 ? req.url.slice(q) : ""));
  }
  if (!u.startsWith(PREFIX)) { res.writeHead(404); return res.end(); }
  let rel = u.slice(PREFIX.length);
  if (rel === "lesson") { res.writeHead(301, { Location: PREFIX + "lesson/" }); return res.end(); }
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const f = path.join(ROOT, rel);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("404"); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});

/* คลาวด์จำลอง: เก็บเอกสารไว้ฝั่ง node แล้วกระจายให้ทุกเครื่องที่ฟังอยู่ เหมือน onSnapshot */
const cloud = new Map(); let clock = 1000; const listeners = new Set();
const FAKE = `
  window.__syncTransportFactory = function(){
    var uid = null;
    return {
      init: function(){ return Promise.resolve({}); },
      onAuth: function(cb){ setTimeout(function(){ cb({ uid:"u1", email:"kru@test" }); }, 0); return function(){}; },
      signIn: function(){ return Promise.resolve(); }, signUp: function(){ return Promise.resolve(); }, signOut: function(){ return Promise.resolve(); },
      fetchSince: function(ms){ return window.__cloud("fetch", ms); },
      listen: function(ms, cb){ window.__cloudCb = cb; window.__cloud("listen", ms).then(function(d){ if (d.length) cb(d); }); return function(){ window.__cloudCb = null; }; },
      commit: function(docs){ return window.__cloud("commit", JSON.parse(JSON.stringify(docs))); },
      putFile: function(){ return Promise.resolve(); }, getFile: function(){ return Promise.resolve(null); },
      wipe: function(){ return Promise.resolve(); }
    };
  };
  try { if (!localStorage.getItem("td_sync")) localStorage.setItem("td_sync", JSON.stringify({ cfg:{ apiKey:"x", projectId:"test", appId:"a" }, first:true })); } catch(e) {}
`;
const crypto = require("crypto");
let ece = null; try { ece = require("http_ece"); } catch (_) {}
async function wirePush(page, name, base) {
  const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  const sub = { endpoint: "https://push.test/pushsvc/" + name, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } };
  await page.addInitScript((sub) => {
    // จำลองระบบแจ้งเตือนของเครื่อง: อนุญาตแล้ว และ subscribe คืนค่าที่มีกุญแจจริง
    let current = null;
    Object.defineProperty(Notification, "permission", { get: () => window.__perm || "default" });
    Notification.requestPermission = () => { window.__perm = "granted"; return Promise.resolve("granted"); };
    const mk = () => ({ endpoint: sub.endpoint, toJSON: () => sub, unsubscribe: () => { current = null; return Promise.resolve(true); } });
    PushManager.prototype.subscribe = function (o) { window.__appKey = o && o.applicationServerKey; current = mk(); return Promise.resolve(current); };
    PushManager.prototype.getSubscription = function () { return Promise.resolve(current); };
  }, sub);
  return { endpoint: sub.endpoint, ecdh, auth };
}
function decrypt(dev, body) {
  return JSON.parse(ece.decrypt(body, { version: "aes128gcm", privateKey: dev.ecdh, authSecret: dev.auth.toString("base64url") }).toString("utf8"));
}
const tick = (at) => new Promise((res) => WORKER.scheduled({ scheduledTime: at }, WENV, { waitUntil: (p) => p.then(res, res) }));

async function wireCloud(page) {
  await page.exposeBinding("__cloud", async ({ page: from }, op, arg) => {
    const since = (ms) => [...cloud.values()].filter((d) => d.ts > (ms || 0));
    if (op === "fetch") return since(arg);
    if (op === "listen") { listeners.add(from); return since(arg); }
    if (op === "commit") {
      const out = arg.map((d) => (cloud.set(d.key, Object.assign({}, d, { ts: ++clock })), cloud.get(d.key)));
      for (const p of listeners) if (p !== from && !p.isClosed())
        p.evaluate((docs) => window.__cloudCb && window.__cloudCb(docs), out).catch(() => {});
      return null;
    }
  });
  await page.addInitScript(FAKE);
}

/* แอปมีรหัสผ่านเข้าเครื่อง — ตั้งรหัสทดสอบแล้วเข้า */
async function login(page) {
  await page.evaluate(() => { lsSet("td_pw", hashPw("1234")); document.getElementById("pw-input").value = "1234"; doLogin(); });
  await page.waitForFunction(() => document.getElementById("app").style.display === "block", null, { timeout: 10000 });
}

(async () => {
  WORKER = (await import(require("url").pathToFileURL(path.join(ROOT, "push-worker", "worker.js")).href)).default;
  await new Promise((r) => server.listen(0, r));
  const BASE = "http://localhost:" + server.address().port + PREFIX;
  const browser = await chromium.launch({ executablePath: chromiumPath() });

  /* 1) iPad: เปิดกลอง → MIDI ก่อน (ให้ SW ตัวนั้นติดตั้ง) แล้วค่อยเปิดแอปบันทึกการสอน */
  console.log("iPad Pro 11 — ออฟไลน์และ Service Worker");
  {
    const ctx = await browser.newContext({ ...devices["iPad Pro 11"], serviceWorkers: "allow" });
    const errors = [];
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(BASE, { waitUntil: "load" });
    await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {});
    await page.goto(BASE + "lesson", { waitUntil: "load" });
    ok(page.url().endsWith("/T/lesson/"), "เปิด /T/lesson แล้วไปที่ /T/lesson/");
    ok(/ครูต้า/.test(await page.title()), "หน้าแอปบันทึกการสอนขึ้น: " + await page.title());
    await login(page);
    const man = await page.evaluate(async () => {
      const href = document.querySelector('link[rel="manifest"]').href;
      const m = await (await fetch(href)).json();
      const icons = await Promise.all(m.icons.map(async (i) => (await fetch(new URL(i.src, href))).ok));
      return { scope: new URL(m.scope, href).pathname, icons, apple: (await fetch(document.querySelector('link[rel="apple-touch-icon"]').href)).ok };
    });
    ok(man.scope === "/T/lesson/", "manifest แยกเป็นแอปของตัวเอง (scope " + man.scope + ")");
    ok(man.icons.every(Boolean) && man.apple, "ไอคอนติดตั้งโหลดได้ครบ");
    await page.waitForFunction(() => navigator.serviceWorker.controller && /\/lesson\/sw\.js$/.test(navigator.serviceWorker.controller.scriptURL), null, { timeout: 15000 })
      .then(() => ok(true, "Service Worker ของ /lesson/ คุมหน้านี้"), () => ok(false, "Service Worker ของ /lesson/ ไม่ทำงาน"));
    // Service Worker แสดงแจ้งเตือนเมื่อมี push เข้ามา (ยิง push จริงผ่าน DevTools Protocol)
    await ctx.grantPermissions(["notifications"], { origin: new URL(BASE).origin });
    const cdp = await ctx.newCDPSession(page);
    const regId = new Promise((res) => cdp.on("ServiceWorker.workerRegistrationUpdated", (e) => {
      const r = e.registrations.find((x) => /\/lesson\/$/.test(x.scopeURL) && !x.isDeleted); if (r) res(r.registrationId);
    }));
    await cdp.send("ServiceWorker.enable");
    await cdp.send("ServiceWorker.deliverPushMessage", { origin: new URL(BASE).origin, registrationId: await regId,
      data: JSON.stringify({ title: "🥁 อีก 30 นาที · 17:00 น้องมิ้น", body: "ส่วนตัว", tag: "kruta-x" }) });
    let notes = [];
    for (let i = 0; i < 40 && !notes.length; i++) {
      await new Promise((r) => setTimeout(r, 200));
      notes = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((x) => x.title + "|" + x.body));
    }
    ok(notes.includes("🥁 อีก 30 นาที · 17:00 น้องมิ้น|ส่วนตัว"), "Service Worker แสดงแจ้งเตือนเมื่อได้รับ push");
    // ไอคอนเล็กบนแถบสถานะ Android ใช้แค่ความโปร่งใส: ต้องเป็นรูปกลองบนพื้นใส ไม่ใช่สี่เหลี่ยมทึบ (ขาวโพน)
    const badge = await page.evaluate(async () => {
      const n = (await (await navigator.serviceWorker.ready).getNotifications())[0];
      const im = new Image(); im.src = new URL(n.badge, location.href).href; await im.decode();
      const c = document.createElement("canvas"); c.width = im.width; c.height = im.height; const x = c.getContext("2d"); x.drawImage(im, 0, 0);
      const a = x.getImageData(0, 0, im.width, im.height).data; let clear = 0, solid = 0;
      for (let i = 3; i < a.length; i += 4) { if (a[i] < 10) clear++; else if (a[i] > 245) solid++; }
      const px = a.length / 4, man = await (await fetch("manifest.webmanifest")).json();
      return { src: n.badge, clear: clear / px, solid: solid / px, mono: man.icons.some((i) => i.purpose === "monochrome") };
    });
    ok(/badge-96\.png$/.test(badge.src) && badge.clear > 0.4 && badge.solid > 0.15 && badge.mono,
      "ไอคอนแจ้งเตือนบนแถบสถานะเป็นรูปกลองบนพื้นใส (" + Math.round(badge.clear * 100) + "% โปร่ง) · manifest มีไอคอน monochrome");

    await page.reload({ waitUntil: "load" });
    await ctx.setOffline(true);
    await page.reload({ waitUntil: "load" }).catch(() => {});
    ok(/ครูต้า/.test(await page.title().catch(() => "")), "ตัดเน็ตแล้วโหลดใหม่ ยังเปิดได้");
    await login(page).then(() => ok(true, "ออฟไลน์ยังเข้าแอปและเห็นข้อมูลในเครื่อง"), () => ok(false, "ออฟไลน์เข้าแอปไม่ได้"));
    await page.goto(BASE, { waitUntil: "load" }).catch(() => {});
    ok(!/ครูต้า/.test(await page.title().catch(() => "")), "ออฟไลน์เปิด /T/ ยังได้กลอง → MIDI ไม่ใช่หน้าบันทึกการสอน");
    await ctx.setOffline(false);
    ok(!errors.length, "ไม่มี error ใน console" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
    await ctx.close();
  }

  /* 2) ล็อกหน้าจอแบบเข้ารหัสมาตรฐาน */
  console.log("ล็อกหน้าจอ (PBKDF2-SHA256)");
  {
    const ctx = await browser.newContext({ ...devices["iPad Pro 11"], serviceWorkers: "block" });
    const page = await ctx.newPage(); const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const app = () => page.evaluate(() => document.getElementById("app").style.display === "block");
    const enter = async (pw) => {
      await page.fill("#pw-input", pw); await page.click("#login-btn");
      await page.waitForFunction(() => !document.getElementById("login-btn").disabled, null, { timeout: 10000 });
    };
    await page.goto(BASE + "lesson/", { waitUntil: "load" });
    ok(await page.evaluate(() => window.__secureLock === "on" && window.__studentDelete === "on" && window.__push === "on" && window.__courseActions === "on" && window.__newPlanned === "on" && !!window.__dark && window.__widget === "on"), "ชั้นเสริมทำงานครบ (" + await page.evaluate(() => window.__secureLock + "/" + window.__studentDelete + "/" + window.__push + "/" + window.__courseActions + "/" + window.__newPlanned) + ")");

    // ตั้งรหัสครั้งแรกด้วยการแตะปุ่มจริง
    const t0 = Date.now();
    await enter("กลองสแนร์99");
    ok(await page.evaluate(() => /^pbkdf2-sha256\$600000\$/.test(localStorage.getItem("td_pw"))), "รหัสผ่านเก็บแบบ PBKDF2 600,000 รอบ (ใช้ " + (Date.now() - t0) + "ms)");
    ok(await page.evaluate(() => /^pbkdf2-sha256\$/.test(localStorage.getItem("td_rec"))), "รหัสกู้คืนเก็บแบบ PBKDF2");
    ok(await page.evaluate(() => !/กลองสแนร์99/.test(JSON.stringify(localStorage))), "ไม่มีตัวรหัสผ่านอยู่ที่ไหนในเครื่อง");
    const code = await page.evaluate(() => document.querySelector("#modal-root div.mono").textContent);
    await page.evaluate(() => confirmSavedCode());
    ok(await app(), "ตั้งรหัสแล้วเข้าแอปได้");

    await page.evaluate(() => lockApp());
    await enter("ผิด"); ok(!(await app()) && /ไม่ถูกต้อง/.test(await page.textContent("#login-err")), "รหัสผิดเข้าไม่ได้");
    await enter("กลองสแนร์99"); ok(await app(), "รหัสถูกเข้าได้");

    // เปลี่ยนรหัส
    await page.evaluate(() => { openChangePw(); });
    await page.fill("#cp0", "ผิด"); await page.fill("#cp1", "ใหม่1234"); await page.fill("#cp2", "ใหม่1234");
    await page.evaluate(() => doChangePw());
    await page.waitForFunction(() => /ไม่ถูกต้อง/.test(document.getElementById("cp-err").textContent), null, { timeout: 10000 });
    ok(true, "เปลี่ยนรหัส: รหัสเดิมผิดถูกปฏิเสธ");
    await page.fill("#cp0", "กลองสแนร์99"); await page.evaluate(() => doChangePw());
    await page.waitForFunction(() => !document.getElementById("cp0"), null, { timeout: 10000 });
    await page.evaluate(() => lockApp()); await enter("ใหม่1234"); ok(await app(), "เปลี่ยนรหัสแล้วเข้าด้วยรหัสใหม่ได้");

    // ลืมรหัส → ใช้รหัสกู้คืน
    await page.evaluate(() => lockApp()); await page.evaluate(() => openForgotPw());
    await page.fill("#rec-code", "AAAA-BBBB-CCCC"); await page.fill("#rec-pw1", "กู้คืน55"); await page.fill("#rec-pw2", "กู้คืน55");
    await page.evaluate(() => doResetPw());
    await page.waitForFunction(() => /ไม่ถูกต้อง/.test(document.getElementById("rec-err").textContent), null, { timeout: 10000 });
    ok(true, "รหัสกู้คืนผิดถูกปฏิเสธ");
    await page.fill("#rec-code", code.toLowerCase()); await page.evaluate(() => doResetPw());
    await page.waitForFunction(() => !document.getElementById("rec-code") && document.querySelector("#modal-root div.mono"), null, { timeout: 10000 });
    const code2 = await page.evaluate(() => document.querySelector("#modal-root div.mono").textContent);
    ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code2) && code2 !== code, "ใช้รหัสกู้คืนแล้วได้รหัสใหม่ (รหัสเก่าใช้ซ้ำไม่ได้)");
    await page.evaluate(() => confirmSavedCode()); ok(await app(), "ตั้งรหัสใหม่ผ่านรหัสกู้คืนแล้วเข้าแอปได้");
    await page.evaluate(() => lockApp()); await enter("กู้คืน55"); ok(await app(), "เข้าด้วยรหัสที่ตั้งใหม่ได้");

    // ผู้ใช้เดิมที่ตั้งรหัสไว้แบบเก่า
    await page.evaluate(() => { localStorage.setItem("td_pw", hashPw("เก่า1234")); localStorage.setItem("td_rec", hashPw("ABCD")); lockApp(); });
    await enter("เก่า1234");
    ok(await app(), "รหัสแบบเก่ายังเข้าได้ (ไม่ต้องตั้งใหม่)");
    ok(await page.evaluate(() => /^pbkdf2-sha256\$/.test(localStorage.getItem("td_pw"))), "เข้าครั้งแรกแล้วอัปเกรดเป็นแบบเข้ารหัสให้เอง");
    await page.waitForFunction(() => /รหัสกู้คืนเดิม/.test(document.body.innerText), null, { timeout: 5000 })
      .then(() => ok(true, "ชวนสร้างรหัสกู้คืนใหม่แทนแบบเก่า"), () => ok(false, "ไม่ชวนสร้างรหัสกู้คืนใหม่"));
    ok(!errors.length, "ไม่มี error ใน console" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
    await ctx.close();
  }

  /* 2.5) โหมดกลางคืน */
  console.log("โหมดกลางคืน");
  {
    const ctx = await browser.newContext({ ...devices["iPad Pro 11"], serviceWorkers: "block" });
    const page = await ctx.newPage(); const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(BASE + "lesson/", { waitUntil: "load" });
    await login(page);
    await page.evaluate(() => {
      closeModal();
      const t = todayStr();
      S.lessons.unshift({ id: 9101, date: t, time: "15:00", kind: "school", duration: 1, rate: 300, heads: 1, attendance: "present", student: "ซีริว", topic: "Rock", notes: "n", scores: [{ label: "จังหวะ", score: 4, remark: "" }], practiceItems: [], updatedAt: nowISO() },
                        { id: 9102, date: t, time: "16:00", kind: "private", duration: 1, rate: 0, heads: 1, attendance: "planned", student: "harvey", topic: "", notes: "", scores: [], practiceItems: [], updatedAt: nowISO() });
      save(); DAYV.date = t; setTab("today"); renderAll();
    });
    // แท็บนักเรียน › รายคน: นับเฉพาะคาบที่มาเรียน (รอยืนยัน/ลา ไม่นับ)
    const cnt = await page.evaluate(() => {
      const t = todayStr();
      S.lessons.unshift({ id: 9103, date: addDays(t, -7), time: "16:00", kind: "private", duration: 1, rate: 0, heads: 1, attendance: "present", student: "harvey", topic: "", notes: "", scores: [], practiceItems: [], updatedAt: nowISO() },
                        { id: 9104, date: addDays(t, -14), time: "16:00", kind: "private", duration: 1, rate: 0, heads: 1, attendance: "sick", student: "harvey", topic: "", notes: "", scores: [], practiceItems: [], updatedAt: nowISO() });
      save(); setTab("students"); setSub("students", "people"); renderAll();
      const txt = (n) => { const b = Array.from(document.querySelectorAll("button.acard")).find((x) => x.textContent.indexOf(n) >= 0); return b ? b.textContent : ""; };
      const out = { h: txt("harvey"), z: txt("ซีริว") };
      S.lessons = S.lessons.filter((l) => l.id !== 9103 && l.id !== 9104); save(); setTab("today"); renderAll();
      return out;
    });
    ok(/มาเรียน 1 ครั้ง/.test(cnt.h) && /มาเรียน 1 ครั้ง/.test(cnt.z) && !/สอนแล้ว/.test(cnt.h + cnt.z),
      "รายชื่อนักเรียน: “มาเรียน N ครั้ง” นับเฉพาะที่มาเรียน (harvey: มา 1 · รอยืนยัน 1 · ลาป่วย 1)");
    // หน้านักเรียน › "ดูคาบนี้": เปิดการ์ดคาบนั้นซ้อนบนหน้านักเรียน (เดิมเด้งไปแท็บบันทึก)
    const lv = await page.evaluate(async () => {
      const tick = (ms) => new Promise((r) => setTimeout(r, ms || 50)), t = todayStr();
      S.lessons.push({ id: 9105, date: addDays(t, -7), time: "16:00", kind: "private", duration: 1, rate: 0, heads: 1, attendance: "present", student: "harvey", topic: "Zombie", notes: "ท่อน Intro", scores: [], practiceItems: [{ pid: "p9105", label: "Paradiddle", done: false }], updatedAt: nowISO() });
      save(); setTab("today"); openStudent("harvey"); await tick();
      const btn = Array.from(document.querySelectorAll("#modal-root button")).find((b) => /ดูคาบนี้/.test(b.textContent) && /S\.expanded=9105/.test(b.getAttribute("onclick")));
      btn.click(); await tick();
      const v = document.getElementById("lesson-view"), out = { tab: S.tab, view: !!v, under: !!document.querySelector("#modal-root .modal-box"), topic: v ? /Zombie/.test(v.innerText) && /Paradiddle/.test(v.innerText) : false };
      const tg = v && v.querySelector('[onclick^="togglePractice("]'); if (tg) tg.click(); await tick();
      out.ticked = S.lessons.find((l) => l.id === 9105).practiceItems[0].done && !!document.getElementById("lesson-view");
      document.querySelector("#lesson-view [data-lv-close]").click(); await tick();
      out.back = !document.getElementById("lesson-view") && !!document.querySelector("#modal-root .modal-box");
      closeModal(); S.lessons = S.lessons.filter((l) => l.id !== 9105); save();
      return out;
    });
    ok(lv.view && lv.under && lv.tab === "today" && lv.topic, "หน้านักเรียน › “ดูคาบนี้”: เปิดการ์ดคาบนั้นทับหน้านักเรียน ไม่เด้งไปแท็บอื่น");
    ok(lv.ticked && lv.back, "ติ๊กการบ้านในการ์ดได้ · ปิดแล้วกลับหน้านักเรียนที่เดิม");
    // หน้ารายได้เปิดที่เดือนนี้ แม้มีคาบรอยืนยันล่วงหน้าในเดือนหน้า
    const money = await page.evaluate(async () => {
      const t = todayStr(), next = addDays(t.slice(0, 8) + "01", 40);
      S.lessons.push({ id: 9106, date: next, time: "16:00", kind: "school", duration: 1, rate: 300, heads: 1, attendance: "planned", student: "ซีริว", topic: "", notes: "", scores: [], practiceItems: [], updatedAt: nowISO() });
      save(); S.sum.period = next.slice(0, 7); setTab("today"); setTab("money");
      const first = S.sum.period; stepPeriod(-1); const prev = S.sum.period; setTab("today"); setTab("money"); const again = S.sum.period;
      S.lessons = S.lessons.filter((l) => l.id !== 9106); save(); setTab("today");
      return { first, prev, again, now: t.slice(0, 7), next: next.slice(0, 7) };
    });
    ok(money.first === money.now && money.again === money.now && money.prev !== money.now, "หน้ารายได้เปิดที่เดือนนี้ (" + money.now + ") ไม่ใช่เดือนที่มีคาบล่วงหน้า (" + money.next + ") · เลื่อนเดือนได้ตามเดิม");
    const bodyBg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    ok(await bodyBg() !== "rgb(22, 20, 15)", "ค่าเริ่มต้นเป็นกลางวัน (ไม่เปลี่ยนหน้าตาเดิมเอง)");
    await page.evaluate(() => { openMenu(); });
    ok(await page.evaluate(() => /โหมดกลางคืน/.test((document.getElementById("th-row") || {}).textContent || "")), "หน้าตั้งค่ามีแถว 🌙 โหมดกลางคืน");
    await page.evaluate(() => { closeModal(); openTheme(); setThemePref("dark"); closeModal(); renderAll(); });
    await page.waitForTimeout(300);
    ok(await bodyBg() === "rgb(22, 20, 15)" && await page.evaluate(() => document.documentElement.getAttribute("data-theme") === "dark"), "เลือกกลางคืนแล้วพื้นหลังเข้ม");

    // สแกนตัวหนังสือที่มองเห็นทุกชิ้น ว่าอ่านออกบนพื้นจริง (WCAG ≥ 3:1 สำหรับทุกขนาด)
    const audit = () => page.evaluate(() => {
      const P = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s); if (!m) return null; const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
      const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      const L = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
      const over = (t, b) => [t[0] * t[3] + b[0] * (1 - t[3]), t[1] * t[3] + b[1] * (1 - t[3]), t[2] * t[3] + b[2] * (1 - t[3]), 1];
      const bgOf = (el) => { const chain = []; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const c = P(getComputedStyle(n).backgroundColor); if (c && c[3] > 0) { chain.push(c); if (c[3] >= 0.99) break; } }
        let b = chain.length && chain[chain.length - 1][3] >= 0.99 ? chain.pop() : [22, 20, 15, 1]; while (chain.length) b = over(chain.pop(), b); return b; };
      const bad = [];
      const els = [...document.querySelectorAll("#app *, #modal-root *")].filter((e) => {
        if (e.closest(".rc-preview,.rcframe,canvas,svg")) return false;
        const r = e.getBoundingClientRect(); if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) return false;
        const cs = getComputedStyle(e); if (cs.visibility === "hidden" || +cs.opacity < 0.5) return false;
        return [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      });
      els.forEach((e) => { const fg = P(getComputedStyle(e).color), bg = bgOf(e); const a = L(fg), b = L(bg); const cr = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        if (cr < 3) bad.push(e.textContent.trim().slice(0, 20) + " (" + cr.toFixed(1) + ")"); });
      return { n: els.length, bad };
    });
    const screens = [
      ["วันนี้", () => { setTab("today"); renderAll(); }],
      ["นักเรียน", () => { setTab("students"); renderAll(); }],
      ["ประวัตินักเรียน", () => { openStudent("ซีริว"); }],
      ["ฟอร์มคาบใหม่", () => { closeModal(); openAdd(); }],
      ["รายได้", () => { closeModal(); setTab("money"); renderAll(); }],
      ["ภาพรวม", () => { setTab("overview"); renderAll(); }],
      ["ตั้งค่า", () => { openMenu(); }],
      ["ซิงค์", () => { closeModal(); openSync(); }],
      ["แจ้งเตือน", () => { closeModal(); openPush(); }]
    ];
    let total = 0; const allBad = [];
    for (const [name, fn] of screens) {
      await page.evaluate(fn); await page.waitForTimeout(250);
      const r = await audit(); total += r.n; r.bad.forEach((b) => allBad.push(name + ": " + b));
    }
    ok(total > 150 && !allBad.length, "ตัวหนังสือ " + total + " ชิ้นใน 9 หน้า อ่านออกทุกชิ้นในโหมดกลางคืน" + (allBad.length ? " — ไม่ผ่าน: " + allBad.slice(0, 6).join(" | ") : ""));

    const ms = await page.evaluate(() => new Promise((res) => { closeModal(); setTab("today"); const t0 = performance.now(); renderAll(); requestAnimationFrame(() => requestAnimationFrame(() => res(performance.now() - t0))); }));
    ok(ms < 400, "วาดหน้าวันนี้ใหม่พร้อมแปลงสีใช้ " + Math.round(ms) + " ms");

    await page.evaluate(() => { setThemePref("light"); closeModal(); });
    ok(await bodyBg() !== "rgb(22, 20, 15)" && await page.evaluate(() => !document.querySelector("[data-dk]") && !document.documentElement.hasAttribute("data-theme")),
      "สลับกลับกลางวัน: คืนสีเดิมครบทุกชิ้น ไม่ต้องโหลดใหม่");
    await page.evaluate(() => setThemePref("dark")); await page.reload({ waitUntil: "domcontentloaded" });
    ok(await page.evaluate(() => document.documentElement.getAttribute("data-theme") === "dark" && getComputedStyle(document.body).backgroundColor === "rgb(22, 20, 15)"),
      "เปิดแอปใหม่: เป็นกลางคืนตั้งแต่หน้าแรก (ไม่มีจอขาวแวบ)");
    ok(!errors.length, "ไม่มี error ใน console" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
    await ctx.close();
  }

  /* 3) ซิงค์เรียลไทม์ iPad ↔ Samsung */
  console.log("ซิงค์ iPad ↔ Samsung (คลาวด์จำลอง)");
  {
    const mk = async (dev, name) => {
      const ctx = await browser.newContext({ ...dev, serviceWorkers: "allow" });
      const p = await ctx.newPage(); const errs = [];
      p.on("pageerror", (e) => errs.push(String(e)));
      await wireCloud(p);
      const push = await wirePush(p, name, BASE);
      await p.goto(BASE + "lesson/", { waitUntil: "load" });
      await login(p);
      // เครื่องที่สองที่มีข้อมูลตัวอย่างอยู่ แอปจะถามก่อนว่าจะรวมหรือใช้ของบนคลาวด์ — เลือกใช้ของบนคลาวด์
      await p.waitForFunction(() => (window.SY && SY.user && !SY.st.first) || window.__syFirstDocs, null, { timeout: 15000 });
      if (await p.evaluate(() => SY.st.first)) {
        ok(true, "เครื่องที่สองถามก่อนว่าจะรวมข้อมูลหรือใช้ของบนคลาวด์");
        await p.evaluate(() => syFirstChoice("cloud"));
      }
      await p.waitForFunction(() => !SY.st.first, null, { timeout: 5000 });
      return { ctx, p, errs, push };
    };
    const ipad = await mk(devices["iPad Pro 11"], "ipad");
    const phone = await mk({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 3.5, isMobile: true, hasTouch: true,
      userAgent: "Mozilla/5.0 (Linux; Android 16; SM-S948B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/29.0 Chrome/136.0 Mobile Safari/537.36" }, "phone");
    const N = await phone.p.evaluate(() => S.lessons.length);

    const t0 = Date.now();
    await ipad.p.evaluate(() => {
      S.lessons.unshift({ id: 990001, date: todayStr(), time: "16:00", kind: "private", duration: 1, rate: 0, heads: 1, courseId: null,
        student: "น้องซิงค์", topic: "ทดสอบซิงค์", notes: "", videoLink: "", nextLesson: "", media: null, scores: [], practiceItems: [], updatedAt: nowISO() });
      save();
    });
    await phone.p.waitForFunction(() => S.lessons.some((l) => l.student === "น้องซิงค์"), null, { timeout: 10000 })
      .then(() => ok(true, "บันทึกบน iPad → ขึ้นบนมือถือเองใน " + ((Date.now() - t0) / 1000).toFixed(1) + " วินาที"),
            () => ok(false, "บันทึกบน iPad ไม่ไปถึงมือถือ"));
    ok(await phone.p.evaluate(() => JSON.parse(localStorage.getItem("td_lessons")).some((l) => l.student === "น้องซิงค์")),
      "มือถือเก็บลงเครื่องแล้ว (ปิดแอปก็ไม่หาย)");

    await phone.p.evaluate(() => { const l = S.lessons.find((x) => x.id === 990001); l.topic = "แก้จากมือถือ"; l.updatedAt = nowISO(); save(); });
    await ipad.p.waitForFunction(() => (S.lessons.find((x) => x.id === 990001) || {}).topic === "แก้จากมือถือ", null, { timeout: 10000 })
      .then(() => ok(true, "แก้บนมือถือ → iPad เห็นเอง"), () => ok(false, "แก้บนมือถือ แต่ iPad ไม่เห็น"));

    await ipad.p.evaluate(() => { trashLessonQuiet(990001); save(); });
    await phone.p.waitForFunction(() => !S.lessons.some((x) => x.id === 990001), null, { timeout: 10000 })
      .then(() => ok(true, "ลบบน iPad → มือถือย้ายลงถังขยะด้วย"), () => ok(false, "ลบบน iPad แต่มือถือยังอยู่"));
    ok(await phone.p.evaluate((n) => S.lessons.length === n, N), "จำนวนคาบบนมือถือกลับมาเท่าเดิม");

    // ลบนักเรียนที่เหลือแต่ของค้าง: คาบที่วางแผนไว้ + ตารางประจำ + ของในถังขยะ (เคสจริงของ "กายำ")
    await ipad.p.evaluate(() => {
      S.lessons.unshift({ id: 990002, date: todayStr(), time: "17:00", kind: "private", duration: 1, rate: 0, heads: 1, courseId: null, attendance: "planned",
        student: "กายำ", topic: "", notes: "", videoLink: "", nextLesson: "", media: null, scores: [], practiceItems: [], updatedAt: nowISO() });
      addScheduleEntry({ student: "กายำ", day: 3, time: "17:00", kind: "private" });
      S.trash.unshift({ type: "lesson", deletedAt: nowISO(), data: { id: 990003, student: "กายำ", date: todayStr(), topic: "เก่า" } });
      save();
    });
    await phone.p.waitForFunction(() => S.students.some((r) => r.key === "กายำ"), null, { timeout: 10000 });
    await ipad.p.evaluate(() => openStudentProfile("กายำ"));
    const box = await ipad.p.evaluate(() => (document.getElementById("sd-box") || {}).innerText || "");
    ok(/ยังลบชื่อนี้ไม่ได้/.test(box) && /วางแผนไว้/.test(box) && /ตารางสอนประจำ/.test(box) && /ถังขยะ/.test(box),
      "หน้าข้อมูลนักเรียนบอกว่าติดอะไรบ้าง");
    await ipad.p.click("#sd-go");
    ok(await ipad.p.evaluate(() => S.students.some((r) => r.key === "กายำ")), "แตะครั้งแรกยังไม่ลบ (ต้องยืนยัน)");
    await ipad.p.click("#sd-go");
    ok(await ipad.p.evaluate(() => !S.students.some((r) => r.key === "กายำ") && !S.schedule.some((e) => e.student === "กายำ")
      && !S.lessons.some((l) => l.student === "กายำ") && !S.trash.some((t) => t.data && t.data.student === "กายำ")), "แตะยืนยันแล้วลบนักเรียนและของค้างบน iPad");
    await phone.p.waitForFunction(() => !S.students.some((r) => r.key === "กายำ") && !S.schedule.some((e) => e.student === "กายำ"), null, { timeout: 10000 })
      .then(() => ok(true, "มือถือลบนักเรียนคนนี้ตามเอง"), () => ok(false, "ลบบน iPad แต่มือถือยังมีนักเรียนคนนี้"));
    await new Promise((r) => setTimeout(r, 2500));
    ok(await ipad.p.evaluate(() => !S.students.some((r) => r.key === "กายำ")), "ชื่อไม่เด้งกลับมาหลังซิงค์");

    // กด + บันทึกคาบเอง → เริ่มเป็น "รอยืนยัน" (เหมือนคาบจากตาราง/ไลน์)
    await ipad.p.evaluate(() => closeModal());
    await ipad.p.click('button[aria-label="เพิ่มคาบสอน"]');
    ok(await ipad.p.evaluate(() => EF._mode === "add" && EF.attendance === "planned" &&
      /ยังไม่ยืนยัน/.test((document.querySelector('#ef-att button[aria-pressed="true"]') || {}).textContent || "")),
      "กด + : สถานะเริ่มต้นเป็น “ยังไม่ยืนยัน”");
    ok(await ipad.p.evaluate(() => LESSON_OPEN && !lessonDirty()), "เปิดฟอร์มเฉย ๆ ไม่นับว่ามีการแก้ค้าง");
    await ipad.p.evaluate(() => efSetAtt("present"));
    ok(await ipad.p.evaluate(() => { const b = [...document.querySelectorAll("#ef-att button")]; return b.some((x) => /ยังไม่ยืนยัน/.test(x.textContent)) && /มาเรียน/.test(b.find((x) => x.getAttribute("aria-pressed") === "true").textContent); }),
      "เลือกมาเรียนแล้ว ปุ่มยังไม่ยืนยันยังอยู่ให้สลับกลับได้");
    await ipad.p.evaluate(() => efSetAtt("planned"));
    await ipad.p.evaluate(() => { EF.student = "น้องกดเอง"; saveLesson(); });
    await ipad.p.waitForFunction(() => S.lessons.some((l) => l.student === "น้องกดเอง"), null, { timeout: 8000 });
    ok(await ipad.p.evaluate(() => S.lessons.find((l) => l.student === "น้องกดเอง").attendance === "planned"), "บันทึกแล้วเป็นคาบรอยืนยัน (ไม่ต้องกรอกหัวข้อ)");
    await ipad.p.evaluate(() => { const l = S.lessons.find((x) => x.student === "น้องมิ้น" && x.attendance === "present"); openEdit(l.id); });
    ok(await ipad.p.evaluate(() => EF._mode === "edit" && EF.attendance === "present" &&
      /มาเรียน/.test(document.querySelector('#ef-att button[aria-pressed="true"]').textContent) &&
      [...document.querySelectorAll("#ef-att button")].some((x) => /ยังไม่ยืนยัน/.test(x.textContent))),
      "แก้คาบเดิมที่มาเรียนแล้ว: สถานะไม่เปลี่ยนเอง แต่มีปุ่มเปลี่ยนกลับเป็นยังไม่ยืนยัน");

    // การ์ดหน้าวันนี้: คาบที่ยืนยันแล้ว แตะ "มาเรียน ▾" → มีปุ่มรอยืนยัน → แตะแล้วกลับเป็นรอยืนยัน
    await ipad.p.evaluate(() => {
      closeModal();
      S.lessons.unshift({ id: 990020, date: todayStr(), time: "15:00", kind: "school", duration: 1, rate: 0, heads: 1, courseId: null, attendance: "present",
        student: "น้องยืนยันแล้ว", topic: "x", notes: "", videoLink: "", nextLesson: "", media: null, scores: [], practiceItems: [], updatedAt: nowISO() });
      save(); DAYV.date = todayStr(); setTab("today"); renderAll();
    });
    await ipad.p.click('button.statbtn[onclick="reopenAtt(990020)"]');
    ok(await ipad.p.isVisible('button.att-planned'), "การ์ดหน้าวันนี้: เมนูเปลี่ยนสถานะมีปุ่ม “รอยืนยัน”");
    await ipad.p.click('button.att-planned');
    ok(await ipad.p.evaluate(() => S.lessons.find((l) => l.id === 990020).attendance === "planned"), "แตะแล้วคาบกลับเป็นรอยืนยัน");
    await phone.p.waitForFunction(() => (S.lessons.find((l) => l.id === 990020) || {}).attendance === "planned", null, { timeout: 10000 })
      .then(() => ok(true, "มือถือเห็นสถานะรอยืนยันตาม"), () => ok(false, "มือถือไม่เห็นสถานะใหม่"));
    await ipad.p.evaluate(() => { S.lessons = S.lessons.filter((l) => l.id !== 990020); S.students = S.students.filter((r) => r.key !== "น้องยืนยันแล้ว"); save(); renderAll(); });
    await ipad.p.evaluate(() => { closeModal(); S.lessons = S.lessons.filter((l) => l.student !== "น้องกดเอง"); S.students = S.students.filter((r) => r.key !== "น้องกดเอง"); save(); });

    // นักเรียนที่มีคอร์ส (เคสจริงของ "ธาวิน"): หน้าประวัติมีปุ่มแก้ไข/ลบคอร์ส และกล่องลบนักเรียนลบคอร์สได้
    await ipad.p.evaluate(() => {
      S.courses.push({ id: 880001, student: "ธาวิน", name: "คอร์ส 10 ครั้ง", sessions: 10, price: 5000, hoursPer: 1 });
      save(); openStudent("ธาวิน");
    });
    ok(await ipad.p.evaluate(() => { const r = document.querySelector("#modal-root .ca-row"); return !!r && /แก้ไขคอร์ส/.test(r.textContent) && /ลบคอร์ส/.test(r.textContent); }),
      "หน้าประวัตินักเรียน: การ์ดคอร์สมีปุ่ม ✎ แก้ไขคอร์ส และ ลบคอร์ส");
    await ipad.p.evaluate(() => document.querySelector("#modal-root .ca-row").children[0].click());
    ok(await ipad.p.evaluate(() => /แก้ไขคอร์ส/.test(document.getElementById("modal-root").innerText) && CF && CF.id === 880001), "ปุ่มแก้ไขเปิดหน้าแก้ไขคอร์สนั้น");
    await ipad.p.evaluate(() => { closeModal(); openStudent("ธาวิน"); document.querySelector("#modal-root .ca-row").children[1].click(); });
    ok(await ipad.p.evaluate(() => /ลบคอร์ส/.test(document.getElementById("modal-root").innerText) && /คอร์ส 10 ครั้ง/.test(document.getElementById("modal-root").innerText)),
      "ปุ่มลบคอร์สเปิดหน้ายืนยันของแอป");
    await ipad.p.evaluate(() => { closeModal(); openStudentProfile("ธาวิน"); });
    ok(await ipad.p.evaluate(() => /คอร์ส 10 ครั้ง/.test((document.getElementById("sd-box") || {}).innerText || "") && !!document.querySelector("#sd-box [data-course]") && !document.getElementById("sd-go")),
      "กล่องลบนักเรียน: แสดงคอร์สพร้อมปุ่มลบคอร์ส");
    await ipad.p.click("#sd-box [data-course]");
    ok(await ipad.p.evaluate(() => S.courses.some((c) => c.id === 880001)), "แตะครั้งแรกยังไม่ลบคอร์ส");
    await ipad.p.click("#sd-box [data-course]");
    ok(await ipad.p.evaluate(() => !S.courses.some((c) => c.id === 880001) && S.trash.some((t) => t.type === "course" && t.data.id === 880001) && !!document.getElementById("sd-go")),
      "ลบคอร์สแล้ว (ไปอยู่ถังขยะ) และมีปุ่มล้างของค้างให้ลบนักเรียนต่อ");
    await ipad.p.click("#sd-go"); await ipad.p.click("#sd-go");
    ok(await ipad.p.evaluate(() => !S.students.some((r) => r.key === "ธาวิน")), "ลบนักเรียนที่เคยมีคอร์สได้");
    await phone.p.waitForFunction(() => !S.students.some((r) => r.key === "ธาวิน") && !S.courses.some((c) => c.id === 880001), null, { timeout: 10000 })
      .then(() => ok(true, "มือถือลบคอร์สและนักเรียนตามเอง"), () => ok(false, "มือถือยังมีคอร์สหรือนักเรียนคนนี้"));

    // นักเรียนที่มีคาบสอนจริง ห้ามลบให้
    await ipad.p.evaluate(() => { closeModal(); openStudentProfile("น้องมิ้น"); });
    ok(await ipad.p.evaluate(() => /คาบที่สอนแล้ว/.test((document.getElementById("sd-box") || {}).innerText || "") && !document.getElementById("sd-go")),
      "มีคาบที่สอนจริง: บอกเหตุผล ไม่มีปุ่มล้างให้");
    await ipad.p.evaluate(() => closeModal());

    // ซิงค์คลาวด์ทำงานอยู่: ไม่ขึ้นแถบ "ยังไม่เคยสำรอง" ทุกวัน · ซิงค์หลุดแล้วกลับมาเตือนตามเดิม
    const bk = await ipad.p.evaluate(() => {
      const has = () => { DAYV.date = todayStr(); setTab("today"); renderAll(); return /สำรอง/.test((document.getElementById("banner-slot") || {}).textContent || ""); };
      delete S.settings.lastBackup; delete S.settings.backupSnoozeUntil;
      const cloud = has(); const old = SY.st.lastOk; SY.st.lastOk = Date.now() - 5 * 86400000; const off = has(); SY.st.lastOk = old;
      S.settings.lastBackup = new Date(Date.now() - 40 * 86400000).toISOString(); S.settings.editsSinceBackup = 5; const stale = has();
      return { cloud, off, stale, snooze: S.settings.backupSnoozeUntil };
    });
    ok(!bk.cloud && bk.off && bk.stale && bk.snooze === undefined,
      "แถบเตือนสำรอง: ซิงค์คลาวด์ปกติไม่กวน · ซิงค์หลุดหรือไม่ได้สำรองเกิน 30 วันยังเตือน (ไม่แก้ค่าที่บันทึก)");

    // หน้าตั้งค่า: แบ่งหมวดตามงาน พับไว้ แตะแล้วกาง (ทีละหมวด จำไว้) · ไม่มีแถวหาย ไม่ล้นจอ · รีเซ็ตแอปอยู่ล่างสุด
    const menu = await phone.p.evaluate(() => {
      localStorage.removeItem("td_menu_open"); openMenu();
      const box = document.getElementById("modal-box"), rows = Array.from(box.querySelectorAll(".srow:not(.mt-head)"));
      const heads = Array.from(box.querySelectorAll(".mt-head"));
      const titles = heads.map((h) => h.querySelector(".mt-tx > div").firstChild.textContent.trim());
      const shut = rows.every((r) => r.offsetParent === null);
      heads[4].click();
      const open1 = rows.filter((r) => r.offsetParent !== null).map((r) => r.textContent);
      heads[1].click();
      const one = box.querySelectorAll(".mt-sec.open").length, remembered = localStorage.getItem("td_menu_open");
      const right = box.getBoundingClientRect().right, over = rows.filter((r) => r.offsetParent && r.getBoundingClientRect().right > right + 1).length;
      const out = { n: rows.length, titles, shut, open1: open1.length, sec: open1.some((t) => /รหัสกู้คืน/.test(t)), one, remembered, over, last: rows[rows.length - 1].textContent, loose: box.querySelectorAll(".statlabel").length };
      closeModal(); openMenu(); out.reopen = (document.querySelector("#modal-box .mt-sec.open .mt-head") || {}).textContent || ""; closeModal();
      return out;
    });
    ok(menu.n >= 22 && menu.titles.join("|") === "การสอน|ส่งผู้ปกครองและหน้าตา|เครื่องนี้และการเชื่อมต่อ|ข้อมูลและการสำรอง|ความปลอดภัย|ล้างข้อมูล" && !menu.loose && /รีเซ็ตแอป/.test(menu.last),
      "หน้าตั้งค่า " + menu.n + " แถว ใน " + menu.titles.length + " หมวด · รีเซ็ตแอปแยกไว้ล่างสุด");
    ok(menu.shut && menu.open1 === 4 && menu.sec && menu.one === 1 && menu.remembered === "ส่งผู้ปกครองและหน้าตา" && /ส่งผู้ปกครอง/.test(menu.reopen) && !menu.over,
      "หมวดพับไว้ แตะแล้วกางทีละหมวด · เปิดเมนูครั้งหน้ากางหมวดเดิม · ไม่ล้นจอมือถือ");

    /* แจ้งเตือนคาบถัดไป */
    console.log("แจ้งเตือนคาบถัดไป (ตัวส่งจริง + KV จำลอง)");
    if (!ece) ok(false, "ต้องติดตั้ง http_ece ก่อน: npm i http_ece");
    await ipad.p.evaluate(() => openMenu());
    ok(await ipad.p.evaluate(() => /แจ้งเตือนคาบถัดไป/.test((document.getElementById("pu-row") || {}).textContent || "")), "หน้าตั้งค่ามีแถว 🔔 แจ้งเตือนคาบถัดไป");
    await ipad.p.evaluate((id) => { const r = document.getElementById(id), sec = r && r.closest(".mt-sec"); if (sec && !sec.classList.contains("open")) sec.querySelector(".mt-head").click(); }, "pu-row");
    await ipad.p.click("#pu-row");
    await ipad.p.fill("#pu-url", BASE + "push");
    await ipad.p.evaluate(() => pushConnect());
    await ipad.p.waitForFunction(() => S.settings.push && S.settings.push.key && document.getElementById("pu-enable"), null, { timeout: 10000 })
      .catch(async (e) => { console.log("    pu-err:", await ipad.p.evaluate(() => (document.getElementById("pu-err") || {}).textContent), JSON.stringify(await ipad.p.evaluate(() => S.settings.push || null))); throw e; });
    ok(kv.get("token") === await ipad.p.evaluate(() => S.settings.push.token), "เชื่อมต่อตัวส่งได้ และตั้งรหัสเข้าใช้ของแอปนี้แล้ว");
    await ipad.p.click("#pu-enable");
    await ipad.p.waitForFunction(() => /เปิดแจ้งเตือนบนเครื่องนี้แล้ว/.test(document.getElementById("modal-root").innerText), null, { timeout: 10000 })
      .catch(async (e) => { console.log("    dbg:", JSON.stringify(await ipad.p.evaluate(async () => ({ toast: (document.getElementById("toast") || {}).innerText, ctrl: !!navigator.serviceWorker.controller, regs: (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope), perm: Notification.permission, err: window.__pushErr, dev: localStorage.getItem("td_push_dev"), modal: document.getElementById("modal-root").innerText.slice(0, 300) }))), kv.get("subs")); throw e; });
    ok(JSON.parse(kv.get("subs") || "[]").some((x) => x.endpoint === ipad.push.endpoint), "iPad: เปิดแจ้งเตือนแล้ว ตัวส่งรู้จักเครื่องนี้");
    ok(await ipad.p.evaluate(() => { const k = window.__appKey, u = new Uint8Array(k.buffer || k); return u.length === 65 && u[0] === 4; }), "ใช้กุญแจ VAPID ของตัวส่งตอนสมัคร");

    // คาบที่วางแผนไว้อีก 40 นาที (ปัดเป็นนาทีเต็ม) → เตือนก่อน 30 นาที
    const start = new Date(Math.ceil((Date.now() + 40 * 60000) / 60000) * 60000);
    const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const hm = String(start.getHours()).padStart(2, "0") + ":" + String(start.getMinutes()).padStart(2, "0");
    await ipad.p.evaluate(([d, t]) => {
      S.lessons.unshift({ id: 990010, date: d, time: t, kind: "private", duration: 1, rate: 0, heads: 1, courseId: null, attendance: "planned",
        student: "น้องเตือน", topic: "", notes: "", videoLink: "", nextLesson: "", media: null, scores: [], practiceItems: [], updatedAt: nowISO() });
      save();
    }, [iso(start), hm]);
    const remOf = () => JSON.parse(kv.get("rem") || "[]").find((r) => /น้องเตือน/.test(r.title));
    const tr0 = Date.now();
    while (!remOf() && Date.now() - tr0 < 12000) await new Promise((r) => setTimeout(r, 300));
    const rem = remOf();
    ok(rem && rem.at === start.getTime() - 30 * 60000, "บันทึกคาบแล้ว รายการเตือนขึ้นตัวส่งเอง (เตือนก่อน 30 นาที)");

    await phone.p.waitForFunction(() => S.settings.push && S.settings.push.token, null, { timeout: 10000 });
    await phone.p.evaluate(() => openPush());
    ok(await phone.p.evaluate(() => !!document.getElementById("pu-enable") && !document.getElementById("pu-url")), "มือถือได้ค่าตัวส่งตามการซิงค์ เหลือแค่กดเปิดบนเครื่อง");
    await phone.p.click("#pu-enable");
    await phone.p.waitForFunction(() => /เปิดแจ้งเตือนบนเครื่องนี้แล้ว/.test(document.getElementById("modal-root").innerText), null, { timeout: 10000 });
    ok(JSON.parse(kv.get("subs") || "[]").length === 2, "มือถือ: เปิดแจ้งเตือนแล้ว (ตัวส่งรู้จัก 2 เครื่อง)");

    pushed.length = 0;
    await tick(rem.at - 60000);
    ok(pushed.length === 0, "นาทีก่อนเวลาเตือน: ยังไม่ส่ง");
    await tick(rem.at);
    ok(pushed.length === 2, "ถึงเวลา: ส่งไปทั้ง iPad และมือถือ");
    if (ece && pushed.length) {
      const got = decrypt(ipad.push, pushed.find((x) => x.url === ipad.push.endpoint).body);
      ok(got.title === "🥁 อีก 30 นาที · " + hm + " น้องเตือน" && /ส่วนตัว/.test(got.body), "ข้อความที่เครื่องได้รับ: “" + got.title + " — " + got.body + "”");
      const got2 = decrypt(phone.push, pushed.find((x) => x.url === phone.push.endpoint).body);
      ok(got2.title === got.title, "มือถือถอดรหัสได้ข้อความเดียวกัน");
    }

    // เปลี่ยนเวลาเตือนบนมือถือ → ค่าใหม่ไปถึงตัวส่ง
    await phone.p.evaluate(() => pushSetLead(15));
    const t1 = Date.now();
    while ((remOf() || {}).at !== start.getTime() - 15 * 60000 && Date.now() - t1 < 10000) await new Promise((r) => setTimeout(r, 300));
    ok((remOf() || {}).at === start.getTime() - 15 * 60000, "เปลี่ยนเป็นเตือนก่อน 15 นาทีบนมือถือ ตัวส่งได้เวลาใหม่");
    await ipad.p.waitForFunction(() => S.settings.pushLead === 15, null, { timeout: 10000 })
      .then(() => ok(true, "iPad ได้ค่า 15 นาทีตามการซิงค์"), () => ok(false, "iPad ไม่ได้ค่าเวลาเตือนใหม่"));

    // หน้าตรวจตัวส่ง: ยังไม่มี Cron → เตือน · Cron ทำงานแล้ว → ✓ และรายการตรงกับในแอป
    kv.delete("beat");                                  // รอบ tick ด้านบนเป็นเวลาในอนาคต ล้างออกให้เหมือนยังไม่ได้ตั้ง Cron
    await ipad.p.evaluate(() => openPush());
    await ipad.p.waitForFunction(() => /ยังไม่ทำงานตามเวลา/.test((document.getElementById("pu-status") || {}).innerText || ""), null, { timeout: 10000 })
      .then(() => ok(true, "ตรวจตัวส่ง: ยังไม่มี Cron → บอกให้ตั้ง Trigger Events"), () => ok(false, "ตรวจตัวส่งไม่เตือนเรื่อง Cron"));
    await tick(Math.floor(Date.now() / 300000) * 300000);
    await ipad.p.evaluate(() => openPush());
    await ipad.p.waitForFunction(() => { const t = (document.getElementById("pu-status") || {}).innerText || ""; return /ตัวส่งทำงานตามเวลา/.test(t) && /ตรงกับในแอป/.test(t); }, null, { timeout: 10000 })
      .then(() => ok(true, "ตรวจตัวส่ง: Cron ทำงาน และรายการบนตัวส่งตรงกับในแอป"),
            async () => ok(false, "ตรวจตัวส่งไม่ผ่าน: " + await ipad.p.evaluate(() => (document.getElementById("pu-status") || {}).innerText)));
    await ipad.p.evaluate(() => closeModal());

    // บันทึกคาบแล้วออกจากแอปทันที → รายการเตือนต้องขึ้นตัวส่งเลย ไม่รอ 4 วินาที
    await ipad.p.evaluate(([d]) => {
      S.lessons.unshift({ id: 990011, date: d, time: "23:58", kind: "school", duration: 1, rate: 0, heads: 1, courseId: null, attendance: "planned",
        student: "น้องรีบปิด", topic: "", notes: "", videoLink: "", nextLesson: "", media: null, scores: [], practiceItems: [], updatedAt: nowISO() });
      save();
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    }, [iso(new Date(Date.now() + 86400000))]);
    const tq = Date.now();
    while (!JSON.parse(kv.get("rem") || "[]").some((r) => /น้องรีบปิด/.test(r.title)) && Date.now() - tq < 3000) await new Promise((r) => setTimeout(r, 100));
    ok(JSON.parse(kv.get("rem") || "[]").some((r) => /น้องรีบปิด/.test(r.title)), "บันทึกแล้วสลับออกจากแอปทันที: รายการเตือนขึ้นตัวส่งใน " + (Date.now() - tq) + " ms");
    await ipad.p.evaluate(() => { delete document.visibilityState; S.lessons = S.lessons.filter((l) => l.id !== 990011); S.students = S.students.filter((r) => r.key !== "น้องรีบปิด"); save(); });

    // วิดเจ็ตหน้าจอโฮม: หน้าตั้งค่า → ส่งตาราง 8 วันขึ้นตัวส่ง → อ่านด้วยรหัสวิดเจ็ตได้
    await ipad.p.evaluate(() => openMenu());
    ok(await ipad.p.evaluate(() => /วิดเจ็ตหน้าจอโฮม/.test((document.getElementById("wg-row") || {}).textContent || "")), "หน้าตั้งค่ามีแถว 🧩 วิดเจ็ตหน้าจอโฮม");
    await ipad.p.evaluate((id) => { const r = document.getElementById(id), sec = r && r.closest(".mt-sec"); if (sec && !sec.classList.contains("open")) sec.querySelector(".mt-head").click(); }, "wg-row");
    await ipad.p.click("#wg-row");
    await ipad.p.waitForFunction(() => /ส่งตาราง \d+ คาบ/.test((document.getElementById("wg-state") || {}).textContent || ""), null, { timeout: 10000 })
      .then(() => ok(true, "เปิดหน้าวิดเจ็ต: ส่งตาราง 8 วันให้วิดเจ็ตแล้ว"), async () => ok(false, "หน้าวิดเจ็ตไม่ส่งตาราง: " + await ipad.p.evaluate(() => (document.getElementById("wg-state") || {}).textContent)));
    const wk = await ipad.p.evaluate(() => S.settings.push.wkey);
    const wres = await (await realFetch(BASE + "push/widget?k=" + encodeURIComponent(wk))).json();
    ok(wres.ok && wres.lessons.some((l) => l.n === "น้องเตือน" && l.s === "planned" && /^\d\d:\d\d$/.test(l.t)), "วิดเจ็ตอ่านตารางจากตัวส่งด้วยรหัสวิดเจ็ตได้");
    const codeOk = await ipad.p.evaluate(() => { const c = (function () { let x; const o = copyText; copyText = (t) => { x = t; }; widgetCopyCode(); copyText = o; return x; })();
      const j = JSON.parse(decodeURIComponent(escape(atob(c.slice(8))))); return c.startsWith("KRUTAW1:") && j.k === S.settings.push.wkey && j.u === S.settings.push.url; });
    ok(codeOk, "รหัสวิดเจ็ตสำหรับ Samsung ถอดกลับได้ถูก (ที่อยู่ + รหัส)");
    await ipad.p.waitForTimeout(500);
    const scr = await ipad.p.evaluate(() => { let x; const o = copyText; copyText = (t) => { x = t; }; widgetCopyScript(); copyText = o; return x || ""; });
    ok(scr.includes(await ipad.p.evaluate(() => S.settings.push.wkey)) && !scr.includes("__KRUTA_") && /Scriptable/.test(scr), "สคริปต์ iPad ใส่ที่อยู่และรหัสให้ครบแล้ว");
    ok(await ipad.p.evaluate((k) => { S.settings.push = { url: S.settings.push.url, token: S.settings.push.token, key: S.settings.push.key }; save(); return S.settings.push.wkey === k; }, wk),
      "settings จากอีกเครื่องที่ไม่มีรหัสวิดเจ็ตมาทับ: เติมรหัสเดิมกลับเอง (วิดเจ็ตไม่พัง)");
    await phone.p.waitForFunction((k) => S.settings.push && S.settings.push.wkey === k, wk, { timeout: 10000 })
      .then(() => ok(true, "รหัสวิดเจ็ตซิงค์ไปมือถือเอง"), () => ok(false, "รหัสวิดเจ็ตไม่ซิงค์ไปมือถือ"));
    await ipad.p.evaluate(() => closeModal());

    // แก้คาบบน iPad: iPad ส่งรายการเตือนเอง มือถือที่รับข้อมูลมาทางซิงค์ไม่ส่งซ้ำ (ประหยัดโควตาเขียน KV)
    await phone.p.evaluate(() => { window.__out = []; const f = window.fetch; window.fetch = (u, o) => { if (/\/(schedule|widget-data)$/.test(String(u))) window.__out.push(String(u)); return f(u, o); }; });
    await ipad.p.evaluate(() => { S.lessons.unshift({ id: 990077, date: addDays(todayStr(), 2), time: "09:15", kind: "private", duration: 1, rate: 0, heads: 1, courseId: null, attendance: "planned", student: "น้องเตือน", topic: "", notes: "", scores: [], practiceItems: [], updatedAt: nowISO() }); save(); });
    await phone.p.waitForFunction(() => S.lessons.some((l) => l.id === 990077), null, { timeout: 10000 }).catch(() => {});
    const tq2 = Date.now();
    while (!JSON.parse(kv.get("rem") || "[]").some((r) => /09:15/.test(r.title)) && Date.now() - tq2 < 9000) await new Promise((r) => setTimeout(r, 200));
    await phone.p.waitForTimeout(5000);
    const dup = await phone.p.evaluate(() => window.__out.length);
    ok(JSON.parse(kv.get("rem") || "[]").some((r) => /09:15/.test(r.title)) && dup === 0, "แก้คาบบน iPad: ตัวส่งได้รายการใหม่ · มือถือไม่ส่งซ้ำ (" + dup + " ครั้ง)");
    await ipad.p.evaluate(() => { S.lessons = S.lessons.filter((l) => l.id !== 990077); save(); });

    // ตารางประจำสัปดาห์ก็เตือนด้วย (ทั้งที่ลงเป็นคาบล่วงหน้าแล้ว และที่ยังไม่ได้ลง)
    const roster = await ipad.p.evaluate(() => {
      const d = addDays(todayStr(), 5);
      addScheduleEntry({ student: "ประจำพุธ", day: new Date(d + "T00:00:00").getDay(), time: "18:30", kind: "private" });
      const d2 = addDays(todayStr(), 19);
      return [d, d2].map((x) => __pushReminders().some((r) => r.id === x + "T18:30" && /ประจำพุธ/.test(r.title)));
    });
    ok(roster[0] && roster[1], "ตารางประจำสัปดาห์: เตือนทุกสัปดาห์ล่วงหน้า 3 สัปดาห์");
    await ipad.p.evaluate(() => { S.schedule = S.schedule.filter((e) => e.student !== "ประจำพุธ"); S.lessons = S.lessons.filter((l) => l.student !== "ประจำพุธ"); S.students = S.students.filter((r) => r.key !== "ประจำพุธ"); save(); });

    // ยกเลิกคาบ → รายการเตือนหาย
    await ipad.p.evaluate(() => { trashLessonQuiet(990010); save(); });
    const t2 = Date.now();
    while (remOf() && Date.now() - t2 < 12000) await new Promise((r) => setTimeout(r, 300));
    ok(!remOf(), "ลบคาบแล้ว รายการเตือนของคาบนั้นหายจากตัวส่ง");

    // เปิดหน้าวิดเจ็ตตรง ๆ (ไม่เคยเข้าหน้าแจ้งเตือน) แล้วกดคัดลอกโค้ดตัวส่ง — ต้องได้โค้ด ไม่ใช่ "ยังโหลดโค้ดไม่เสร็จ"
    await phone.p.reload(); await login(phone.p);
    const wcode = await phone.p.evaluate(async () => {
      let x = ""; const o = copyText; copyText = (t) => { x = t; };
      openWidget(); pushCopyWorker();                     // แตะทันทีที่เปิดหน้า: โหลดแล้วคัดลอกให้เอง
      for (let i = 0; i < 50 && !x; i++) await new Promise((r) => setTimeout(r, 100));
      const first = x; x = "";
      pushCopyWorker(); const second = x;                 // แตะครั้งต่อไป: คัดลอกทันที (iPad ต้องการแบบนี้)
      copyText = o; closeModal(); return { first, second };
    });
    ok(/VERSION\s*=\s*3/.test(wcode.first) && wcode.second === wcode.first, "หน้าวิดเจ็ต: ปุ่มคัดลอกโค้ดตัวส่งรุ่นใหม่ได้โค้ดจริง (แตะครั้งแรกก็ได้)");

    pushed.length = 0;
    await ipad.p.evaluate(() => { openPush(); pushTest(); });
    await ipad.p.waitForFunction(() => /ส่งทดสอบแล้ว 2 เครื่อง/.test(document.body.innerText), null, { timeout: 10000 })
      .then(() => ok(true, "ปุ่มส่งทดสอบ: ส่งถึง 2 เครื่อง"), () => ok(false, "ปุ่มส่งทดสอบไม่ทำงาน"));
    await ipad.p.evaluate(() => closeModal()); await phone.p.evaluate(() => closeModal());

    const shot = path.join(process.env.SHOT_DIR || ROOT, "lesson-phone.png");
    await phone.p.screenshot({ path: shot });
    console.log("  ภาพหน้าจอมือถือ: " + shot);
    const errs = ipad.errs.concat(phone.errs);
    ok(!errs.length, "ไม่มี error ใน console" + (errs.length ? ": " + errs.slice(0, 3).join(" | ") : ""));
    await ipad.ctx.close(); await phone.ctx.close();
  }

  await browser.close(); server.close();
  console.log(fail.length ? "\n✗ ไม่ผ่าน " + fail.length + " ข้อ" : "\n✓ ผ่านทั้งหมด");
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
