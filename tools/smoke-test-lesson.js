#!/usr/bin/env node
/* ตรวจแอป "ครูต้า — บันทึกการสอน" (/lesson/) ด้วยเบราว์เซอร์จริง
 *
 *   npm i playwright && node tools/smoke-test-lesson.js
 *
 * เสิร์ฟโปรเจกต์ใต้ /T/ เลียนแบบ GitHub Pages แล้วตรวจว่า
 *   เปิดขึ้นทั้งจอ iPad และจอมือถือ · manifest/ไอคอนโหลดได้ (ติดตั้งลงหน้าโฮมได้)
 *   Service Worker ของ /lesson/ ทำงาน · ตัดเน็ตแล้วยังเปิดได้
 *   Service Worker ของกลอง → MIDI ไม่เก็บหน้า /lesson/ ไปทับสำเนาของตัวเอง
 *   ซิงค์สองเครื่องแบบเรียลไทม์ (ใช้คลาวด์จำลองแทน Firebase ผ่านช่อง
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

const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split("?")[0]);
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

  /* 2) ซิงค์เรียลไทม์ iPad ↔ Samsung */
  console.log("ซิงค์ iPad ↔ Samsung (คลาวด์จำลอง)");
  {
    const mk = async (dev) => {
      const ctx = await browser.newContext({ ...dev, serviceWorkers: "block" });
      const p = await ctx.newPage(); const errs = [];
      p.on("pageerror", (e) => errs.push(String(e)));
      await wireCloud(p);
      await p.goto(BASE + "lesson/", { waitUntil: "load" });
      await login(p);
      // เครื่องที่สองที่มีข้อมูลตัวอย่างอยู่ แอปจะถามก่อนว่าจะรวมหรือใช้ของบนคลาวด์ — เลือกใช้ของบนคลาวด์
      await p.waitForFunction(() => (window.SY && SY.user && !SY.st.first) || window.__syFirstDocs, null, { timeout: 15000 });
      if (await p.evaluate(() => SY.st.first)) {
        ok(true, "เครื่องที่สองถามก่อนว่าจะรวมข้อมูลหรือใช้ของบนคลาวด์");
        await p.evaluate(() => syFirstChoice("cloud"));
      }
      await p.waitForFunction(() => !SY.st.first, null, { timeout: 5000 });
      return { ctx, p, errs };
    };
    const ipad = await mk(devices["iPad Pro 11"]);
    const phone = await mk({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 3.5, isMobile: true, hasTouch: true,
      userAgent: "Mozilla/5.0 (Linux; Android 16; SM-S948B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/29.0 Chrome/136.0 Mobile Safari/537.36" });
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
