#!/usr/bin/env node
/* ตรวจเว็บแอปด้วยเบราว์เซอร์จริง ก่อน push ทุกครั้งที่อัปเดตไฟล์ HTML
 *
 *   npm i playwright && node tools/smoke-test.js
 *
 * เสิร์ฟโปรเจกต์ใต้ /T/ เลียนแบบ GitHub Pages แล้วเปิดด้วย Chromium
 * ทั้งขนาดจอ iPad และ iPhone ตรวจว่า
 *   โปรแกรมเปิดขึ้น · ฟอนต์ในเครื่องมา · ไม่มีคำขอออกนอกเครื่อง
 *   Service Worker ทำงาน · ตัดเน็ตแล้วยังเปิดได้
 *   แตะนิ้ววางโน้ตได้ · ส่งออก .mid/.musicxml ได้จริง · กดเล่นแล้วเวลาเดิน
 *   ไม่มี CSP violation · ไม่มี error ใน console
 *
 * ออก 0 = ผ่าน, 1 = ไม่ผ่าน (รายการที่ไม่ผ่านพิมพ์ไว้ท้ายสุด)
 */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium, devices } = require("playwright");

const ROOT = path.resolve(__dirname, ".."), PREFIX = "/T/";
let BASE = "";                 // เติมตอนเซิร์ฟเวอร์จับพอร์ตได้แล้ว
const fail = [];
const MIME = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8", ".webmanifest":"application/manifest+json",
  ".json":"application/json", ".png":"image/png", ".woff2":"font/woff2", ".svg":"image/svg+xml" };

/* หา Chromium ที่ติดตั้งไว้แล้วในเครื่อง (sandbox ของ Claude Code มีให้อยู่แล้ว
   ที่ PLAYWRIGHT_BROWSERS_PATH) ถ้าไม่เจอก็คืน undefined ให้ playwright หาเอง */
function findChromium() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  let best = null, bestRev = -1;
  let entries;
  try { entries = fs.readdirSync(base); } catch (_) { return undefined; }
  for (const e of entries) {
    const m = /^chromium-(\d+)$/.exec(e);       // ข้าม chromium_headless_shell-* ที่รุ่นอาจไม่ตรงกัน
    if (!m) continue;
    const p = path.join(base, e, "chrome-linux", "chrome");
    if (fs.existsSync(p) && +m[1] > bestRev) { best = p; bestRev = +m[1]; }
  }
  return best || undefined;
}

function serve() {
  return http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (!p.startsWith(PREFIX)) { res.writeHead(404); return res.end(); }
    let rel = p.slice(PREFIX.length) || "index.html";
    if (rel.endsWith("/")) rel += "index.html";
    const f = path.join(ROOT, rel);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(fs.existsSync(path.join(ROOT, "404.html"))
        ? fs.readFileSync(path.join(ROOT, "404.html")) : "404");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
}

async function suite(label, ctxOpts, exe) {
  const browser = await chromium.launch({ executablePath: exe });
  const ctx = await browser.newContext({ ...ctxOpts, acceptDownloads: true });
  const page = await ctx.newPage();
  const csp = [], errs = [];
  await page.exposeFunction("__csp", (d) => csp.push(d));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation",
    (e) => window.__csp(`${e.violatedDirective} <- ${e.blockedURI}`)));
  page.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  const say = (s) => console.log(`[${label}] ${s}`);

  await page.goto(BASE, { waitUntil: "load" });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(600);

  if (await page.locator("#gate").count()) fail.push(`${label}: ประตูหน้ายังอยู่ = โปรแกรมไม่รัน`);
  if (!(await page.locator("#drop").isVisible())) fail.push(`${label}: #drop ไม่แสดง`);

  const font = await page.evaluate(async () => { await document.fonts.ready;
    return [...document.fonts].some((f) => f.family.includes("IBM Plex Sans Thai") && f.status === "loaded"); });
  say(`ฟอนต์ในเครื่อง=${font}`);
  if (!font) fail.push(`${label}: ฟอนต์ในเครื่องไม่ถูกโหลด`);

  const ext = await page.evaluate(() => performance.getEntriesByType("resource")
    .map((r) => r.name).filter((n) => !n.startsWith(location.origin) &&
      !n.startsWith("blob:") && !n.startsWith("data:")));
  say(`คำขอออกนอกเครื่อง=${ext.length ? JSON.stringify(ext) : "ไม่มี"}`);
  if (ext.length) fail.push(`${label}: มีคำขอออกนอกเครื่อง ${ext}`);

  const sw = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready.catch(() => null);
    return r ? { scope: r.scope, controlled: !!navigator.serviceWorker.controller } : null; });
  say(`serviceWorker=${JSON.stringify(sw)}`);
  if (!sw || !sw.controlled) fail.push(`${label}: service worker ไม่ได้คุมหน้า`);

  await page.click("#blank");
  await page.waitForTimeout(600);
  await page.click('#tool button[data-v="draw"]');
  await page.evaluate(() => document.getElementById("gw").scrollIntoView({ block: "start" }));
  await page.waitForTimeout(400);

  const geo = await page.evaluate(() => {
    const cv = document.querySelector("#gw canvas").getBoundingClientRect();
    const tp = document.getElementById("tp").getBoundingClientRect();
    const labelW = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue("--labelw")) || 132;
    const rows = [...document.querySelectorAll("#labels .r")].map((r) => {
      const b = r.getBoundingClientRect();
      return { nm: r.querySelector(".nm").textContent, ymid: b.top + b.height / 2 };
    }).filter((r) => r.ymid > cv.top + 175 && r.ymid < tp.top - 12);
    return { x0: cv.left + labelW + 20, rows: rows.slice(0, 3) };
  });
  if (!geo.rows.length) { fail.push(`${label}: ไม่มีแถวที่แตะได้`); await browser.close(); return; }
  for (const r of geo.rows) for (const dx of [0, 70, 140]) {
    await page.touchscreen.tap(geo.x0 + dx, r.ymid); await page.waitForTimeout(80);
  }
  const stats = await page.evaluate(() =>
    document.getElementById("stats").textContent.replace(/\s+/g, " ").trim());
  say(`แตะวางโน้ต → ${stats}`);
  if (!/ตัวโน้ตรวม\s*[1-9]/.test(stats)) fail.push(`${label}: แตะแล้วไม่มีโน้ตเกิดขึ้น`);

  for (const [id, ext_, magic] of [["#exp", "mid", "MThd"], ["#expX", "musicxml", "<?xml"]]) {
    const dl = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }).catch(() => null), page.click(id),
    ]).then((r) => r[0]);
    if (!dl) { fail.push(`${label}: ส่งออก .${ext_} ไม่ได้ไฟล์`); say(`.${ext_}: ไม่มีไฟล์`); continue; }
    const p = path.join(require("os").tmpdir(), `smoke-${label}.${ext_}`);
    await dl.saveAs(p);
    const b = fs.readFileSync(p), head = b.slice(0, magic.length).toString("utf8");
    say(`ส่งออก .${ext_}: ${dl.suggestedFilename()} · ${b.length} B · ${head === magic ? "OK" : "ผิดรูปแบบ"}`);
    if (head !== magic) fail.push(`${label}: ไฟล์ .${ext_} ผิดรูปแบบ`);
  }

  await page.click("#play").catch(() => {});
  await page.waitForTimeout(1200);
  const clock = await page.evaluate(() => {
    const el = document.querySelector(".clock"); return el ? el.textContent.trim() : ""; });
  say(`หลังกดเล่น: ${clock.replace(/\s+/g, " ")}`);
  if (!/0:0[1-9]|0:[1-9]/.test(clock)) fail.push(`${label}: กดเล่นแล้วเวลาไม่เดิน`);
  await page.click("#stop").catch(() => {});

  await ctx.setOffline(true);
  await page.goto(BASE, { waitUntil: "load" })
    .catch((e) => fail.push(`${label}: โหลดตอนออฟไลน์ไม่ได้ ${e.message}`));
  await page.waitForTimeout(1200);
  const offOk = (await page.locator("#gate").count()) === 0 &&
                (await page.locator("#drop").isVisible().catch(() => false));
  const offFont = await page.evaluate(async () => { await document.fonts.ready;
    return [...document.fonts].some((f) => f.family.includes("IBM Plex Sans Thai") && f.status === "loaded"); });
  say(`ออฟไลน์: เปิดได้=${offOk} ฟอนต์มา=${offFont}`);
  if (!offOk) fail.push(`${label}: ออฟไลน์แล้วโปรแกรมไม่ขึ้น`);
  if (!offFont) fail.push(`${label}: ออฟไลน์แล้วฟอนต์ไม่มา`);
  await ctx.setOffline(false);

  const real = errs.filter((e) => !/favicon/i.test(e));
  say(`CSP=${csp.length ? JSON.stringify(csp) : "ไม่มี"} · errors=${real.join(" | ") || "ไม่มี"}`);
  if (csp.length) fail.push(`${label}: CSP ${csp[0]}`);
  if (real.length) fail.push(`${label}: ${real[0]}`);
  await browser.close();
}

(async () => {
  const exe = findChromium();
  const server = serve();
  // พอร์ต 0 = ให้ระบบเลือกพอร์ตว่างให้ จะได้ไม่ชนกับอะไรที่เปิดค้างอยู่
  await new Promise((ok, no) => { server.once("error", no); server.listen(0, "127.0.0.1", ok); });
  BASE = `http://127.0.0.1:${server.address().port}${PREFIX}`;
  console.log(`เสิร์ฟที่ ${BASE}\n`);
  try {
    await suite("iPad", { ...devices["iPad Pro 11"], hasTouch: true, isMobile: false }, exe);
    await suite("iPhone", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
      hasTouch: true, isMobile: true, userAgent: devices["iPhone 13"].userAgent }, exe);
  } finally { server.close(); }
  console.log("\n================ RESULT ================");
  if (fail.length) { console.log("ไม่ผ่าน:\n - " + fail.join("\n - ")); process.exit(1); }
  console.log("ผ่านทั้งหมด");
})();
