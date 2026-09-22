#!/usr/bin/env node
/* ตรวจแอป ครูต้า (lesson/) ด้วยเบราว์เซอร์จริง ก่อน push ทุกครั้ง
 *
 *   npm i playwright && node tools/smoke-test-lesson.js
 *
 * เสิร์ฟโปรเจกต์ใต้ /T/ เหมือน GitHub Pages แล้วเปิดด้วย Chromium
 * ขนาดจอ iPad Pro 13" (M4) และ Galaxy S26 Ultra แบบจอสัมผัส ตรวจว่า
 *   ตั้งรหัสผ่านครั้งแรก → ได้รหัสกู้คืน → เข้าแอปได้
 *   บันทึกคาบสอนผ่านหน้าจอจริง แล้วข้อมูลอยู่ครบหลังปิด-เปิดใหม่
 *   Service Worker คุมหน้า · ตัดเน็ตแล้วเปิดใหม่ ยังเข้าได้ ข้อมูลยังอยู่
 *   สำรองข้อมูลเป็นไฟล์ได้จริง และไฟล์อ่านกลับได้
 *   ช่องวันที่เป็นธีมมืด · ไม่มีอะไรล้นจอด้านข้าง
 *   ไม่มีคำขอออกนอกเครื่อง · ไม่มี CSP violation · ไม่มี error ใน console
 *   แอปหน้าแรก (กลอง → MIDI) ไม่เก็บหน้าแอปนี้ทับตัวเอง
 *
 * ออก 0 = ผ่าน, 1 = ไม่ผ่าน
 */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, ".."), PREFIX = "/T/";
let ORIGIN = "";
let SWVER = "";                 // เปลี่ยนค่านี้ = จำลองว่ามี deploy รุ่นใหม่
const fail = [];
const MIME = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8", ".webmanifest":"application/manifest+json",
  ".json":"application/json", ".png":"image/png", ".woff2":"font/woff2" };

const DEVICES = {
  "iPad Pro 13 M4": {
    viewport: { width: 1032, height: 1376 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15" },
  "Galaxy S26 Ultra": {
    viewport: { width: 412, height: 891 }, deviceScaleFactor: 3.5, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 16; SM-S948B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36" },
  "Galaxy S26 Ultra แนวนอน": {
    viewport: { width: 891, height: 412 }, deviceScaleFactor: 3.5, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 16; SM-S948B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36" },
};

function findChromium() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  let best, bestRev = -1;
  try {
    for (const e of fs.readdirSync(base)) {
      const m = /^chromium-(\d+)$/.exec(e);
      if (!m) continue;
      const p = path.join(base, e, "chrome-linux", "chrome");
      if (fs.existsSync(p) && +m[1] > bestRev) { best = p; bestRev = +m[1]; }
    }
  } catch (_) {}
  return best;
}

function serve() {
  return http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (!p.startsWith(PREFIX)) { res.writeHead(404); return res.end(); }
    let rel = p.slice(PREFIX.length) || "index.html";
    if (rel.endsWith("/")) rel += "index.html";
    const f = path.join(ROOT, rel);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404); return res.end("404");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
    if (rel === "lesson/sw.js") return res.end(fs.readFileSync(f, "utf8") + "\n// " + SWVER);
    fs.createReadStream(f).pipe(res);
  });
}

async function login(page, pw) {
  await page.locator("#pw-input").fill(pw);
  await page.locator("#login-btn").tap();
}
const lessonCount = (page) => page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem("td_lessons") || "[]").length; } catch (_) { return -1; }
});

async function suite(label, ctxOpts, exe) {
  const browser = await chromium.launch({ executablePath: exe });
  const ctx = await browser.newContext({ ...ctxOpts, acceptDownloads: true, serviceWorkers: "allow" });
  const page = await ctx.newPage();
  const csp = [], errs = [];
  await page.exposeFunction("__csp", (d) => csp.push(d));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation",
    (e) => window.__csp(`${e.violatedDirective} <- ${e.blockedURI}`)));
  page.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  const say = (s) => console.log(`[${label}] ${s}`);
  const APP = ORIGIN + PREFIX + "lesson/";

  // 0) เปิดแอปหน้าแรกก่อน ให้ Service Worker ของมันลงทะเบียน แล้วดูว่าไม่ยุ่งกับ lesson/
  await page.goto(ORIGIN + PREFIX, { waitUntil: "load" });
  await page.evaluate(() => navigator.serviceWorker.ready);

  // 1) เปิดครั้งแรก → ตั้งรหัส
  await page.goto(APP, { waitUntil: "load" });
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!(await page.locator("#pw-input").isVisible())) fail.push(`${label}: ไม่เห็นหน้าใส่รหัสผ่าน`);
  await login(page, "1234");
  await page.waitForTimeout(300);
  const code = await page.locator(".modal-box .mono").first().textContent().catch(() => "");
  say(`รหัสกู้คืน=${code}`);
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(String(code).trim())) fail.push(`${label}: ไม่ขึ้นรหัสกู้คืน`);
  await page.getByText("เก็บไว้แล้ว เข้าใช้งาน").tap();
  await page.waitForTimeout(600);
  if (!(await page.locator("#app").isVisible())) fail.push(`${label}: เข้าแอปไม่ได้หลังตั้งรหัส`);

  // 2) บันทึกคาบสอนผ่านหน้าจอจริง
  const before = await lessonCount(page);
  await page.locator('button[aria-label="เพิ่มคาบสอน"]').tap();
  await page.waitForTimeout(400);
  await page.locator('input[placeholder="ชื่อนักเรียน"]').fill("น้องทดสอบ");
  await page.locator('input[placeholder^="เช่น จังหวะ"]').fill("ทดสอบบันทึก");
  const dateScheme = await page.evaluate(() => {
    const d = document.querySelector('.modal-box input[type=date]');
    return d ? getComputedStyle(d).colorScheme : "none";
  });
  say(`ช่องวันที่ color-scheme=${dateScheme}`);
  if (!/dark/.test(dateScheme)) fail.push(`${label}: ช่องวันที่ไม่ใช่ธีมมืด (ไอคอนปฏิทินจะมองไม่เห็นบน Android)`);
  const saveVis = await page.evaluate(() => {
    const b = document.getElementById("save-btn"); if (!b) return false;
    const r = b.getBoundingClientRect(); return r.bottom <= innerHeight + 1 && r.top >= 0;
  });
  if (!saveVis) fail.push(`${label}: ปุ่มบันทึกในหน้าต่างกรอกข้อมูลไม่อยู่ในจอ`);
  await page.locator("#save-btn").tap();
  await page.waitForTimeout(900);
  const after = await lessonCount(page);
  say(`จำนวนคาบในเครื่อง ${before} → ${after}`);
  if (after !== before + 1 && !(before === 0 && after >= 1)) fail.push(`${label}: บันทึกคาบสอนแล้วไม่ถูกเก็บลงเครื่อง`);
  const hasName = await page.evaluate(() => (localStorage.getItem("td_lessons") || "").includes("น้องทดสอบ"));
  if (!hasName) fail.push(`${label}: ไม่เจอคาบที่เพิ่งบันทึกใน localStorage`);
  await page.waitForTimeout(1000);   // ให้สำเนาใน IndexedDB (debounce 700ms) เขียนเสร็จ
  const mirror = await page.evaluate(() => new Promise((res) => {
    const rq = indexedDB.open("drumlog");
    rq.onsuccess = () => { const g = rq.result.transaction("media").objectStore("media").get("state:mirror");
      g.onsuccess = () => res(g.result && g.result.lessons ? g.result.lessons.length : 0); g.onerror = () => res(-1); };
    rq.onerror = () => res(-1);
  }));
  say(`สำเนาสำรองใน IndexedDB มี ${mirror} คาบ`);
  if (mirror !== after) fail.push(`${label}: สำเนาใน IndexedDB ไม่ตรงกับข้อมูลหลัก (${mirror} ≠ ${after})`);

  // 3) ล้นจอด้านข้าง
  for (const tab of ["today", "students", "money"]) {
    await page.locator(`#tab-${tab}`).tap(); await page.waitForTimeout(350);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (over > 1) fail.push(`${label}: แท็บ ${tab} ล้นจอด้านข้าง ${over}px`);
  }
  await page.locator("#tab-today").tap();

  // 4) Service Worker
  const sw = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    return { scope: r.scope, controlled: !!navigator.serviceWorker.controller,
             script: navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL };
  });
  say(`serviceWorker=${JSON.stringify(sw)}`);
  if (!sw.controlled || !/\/T\/lesson\/sw\.js$/.test(sw.script || "")) fail.push(`${label}: Service Worker ของแอปไม่ได้คุมหน้า`);

  // 5) ปิดเปิดใหม่ → ข้อมูลอยู่
  await page.reload({ waitUntil: "load" });
  await login(page, "1234"); await page.waitForTimeout(600);
  if (!(await page.locator("#app").isVisible())) fail.push(`${label}: รหัสเดิมเข้าไม่ได้หลังเปิดใหม่`);
  if ((await lessonCount(page)) !== after) fail.push(`${label}: ข้อมูลไม่ครบหลังเปิดใหม่`);

  // 6) ตัดเน็ต → เปิดใหม่ยังเข้าได้
  await ctx.setOffline(true);
  await page.reload({ waitUntil: "load" }).catch((e) => fail.push(`${label}: ออฟไลน์แล้วโหลดไม่ขึ้น ${e.message}`));
  const offOk = await page.locator("#pw-input").isVisible().catch(() => false);
  say(`ออฟไลน์เปิดได้=${offOk}`);
  if (!offOk) fail.push(`${label}: ออฟไลน์แล้วเปิดแอปไม่ขึ้น`);
  else {
    await login(page, "1234"); await page.waitForTimeout(600);
    if ((await lessonCount(page)) !== after) fail.push(`${label}: ออฟไลน์แล้วข้อมูลไม่ครบ`);
  }
  await ctx.setOffline(false);

  // 7) สำรองข้อมูลเป็นไฟล์ แล้วอ่านกลับ
  const dl = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
  await page.evaluate(() => doBackup("download"));
  const d = await dl;
  if (!d) fail.push(`${label}: กดสำรองข้อมูลแล้วไม่ได้ไฟล์`);
  else {
    const p = await d.path();
    let j = null; try { j = JSON.parse(fs.readFileSync(p, "utf8")); } catch (_) {}
    const n = j && Array.isArray(j.lessons) ? j.lessons.length : -1;
    say(`ไฟล์สำรอง ${d.suggestedFilename()} มี ${n} คาบ`);
    if (n !== after) fail.push(`${label}: ไฟล์สำรองไม่ครบ (${n} ≠ ${after})`);
  }

  // 7.5) มีรุ่นใหม่ → แถบอัปเดตขึ้น → กดแล้วได้รุ่นใหม่ ข้อมูลยังอยู่
  if (await page.locator("#swbar").count()) fail.push(`${label}: แถบอัปเดตขึ้นทั้งที่ยังไม่มีรุ่นใหม่`);
  SWVER = label + "-v2";
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r && r.update()));
  const bar = await page.locator("#swbar").waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  say(`มีรุ่นใหม่ → แถบอัปเดตขึ้น=${bar}`);
  if (!bar) fail.push(`${label}: มีรุ่นใหม่แล้วแถบอัปเดตไม่ขึ้น`);
  else {
    await Promise.all([page.waitForNavigation({ timeout: 8000 }).catch(() => null), page.locator("#swgo").tap()]);
    await page.waitForTimeout(400);
    if (!(await page.locator("#pw-input").isVisible())) fail.push(`${label}: กดอัปเดตแล้วแอปไม่กลับมา`);
    await login(page, "1234"); await page.waitForTimeout(500);
    if ((await lessonCount(page)) !== after) fail.push(`${label}: อัปเดตแล้วข้อมูลไม่ครบ`);
  }

  // 8) แอปหน้าแรกต้องไม่ถูกเก็บทับด้วยหน้าแอปนี้
  const rootCache = await page.evaluate(async () => {
    for (const k of await caches.keys()) {
      if (!k.startsWith("klong-")) continue;
      const r = await (await caches.open(k)).match("./index.html".replace("./", location.origin + "/T/"));
      if (r) return (await r.text()).includes("Drum Lesson Log") ? "ถูกทับ" : "ปกติ";
    }
    return "ไม่มี";
  });
  say(`แคชของแอปหน้าแรก=${rootCache}`);
  if (rootCache === "ถูกทับ") fail.push(`${label}: Service Worker ของหน้าแรกเก็บหน้าแอปนี้ทับตัวโปรแกรมของมัน`);

  const ext = await page.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name)
    .filter((n) => !n.startsWith(location.origin) && !n.startsWith("data:") && !n.startsWith("blob:")));
  if (ext.length) fail.push(`${label}: มีคำขอออกนอกเครื่อง ${ext}`);
  if (csp.length) fail.push(`${label}: CSP บล็อก ${JSON.stringify(csp)}`);
  const realErrs = errs.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e));
  if (realErrs.length) fail.push(`${label}: error ใน console ${JSON.stringify(realErrs)}`);
  say(`CSP=${csp.length} error=${realErrs.length} ออกนอกเครื่อง=${ext.length}`);

  await page.screenshot({ path: path.join(process.env.SHOTS || "/tmp", `lesson-${label.replace(/\s+/g, "-")}.png`) });
  await browser.close();
}

(async () => {
  const srv = serve();
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  ORIGIN = `http://127.0.0.1:${srv.address().port}`;
  const exe = findChromium();
  try {
    for (const [label, opts] of Object.entries(DEVICES)) await suite(label, opts, exe);
  } catch (e) { fail.push("สคริปต์ทดสอบล้ม: " + (e && e.stack || e)); }
  srv.close();
  if (fail.length) { console.log("\n❌ ไม่ผ่าน"); fail.forEach((f) => console.log("  ✗ " + f)); process.exit(1); }
  console.log("\n✅ ผ่านทุกข้อ");
})();
