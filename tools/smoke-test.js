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
  ".json":"application/json", ".png":"image/png", ".woff2":"font/woff2", ".svg":"image/svg+xml",
  ".mp3":"audio/mpeg" };

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

/* กดตัวแรกในรายการที่มองเห็นอยู่ คืน selector ที่กดได้ หรือ null
   มีไว้เพราะปุ่มย้าย/เปลี่ยนชื่อระหว่างรุ่น เช่นรุ่น 11 ย้ายส่งออกไปหน้าแยก
   และเปลี่ยน #stop เป็น #stopb ชุดทดสอบจะได้ไม่พังทุกครั้งที่ UI ขยับ */
async function clickFirst(page, sels) {
  for (const s of sels) {
    const el = page.locator(s).first();
    if (await el.count() && await el.isVisible().catch(() => false)) { await el.click(); return s; }
  }
  return null;
}

/* โปรแกรมเปิดขึ้นแล้วหรือยัง: ประตูหน้าต้องหาย และหน้าแรกต้องโผล่
   รุ่น 8 หน้าแรกคือ #drop รุ่น 11 เปลี่ยนเป็น #homeScreen */
async function booted(page) {
  if (await page.locator("#gate").count()) return false;
  for (const s of ["#homeScreen", "#drop"]) {
    if (await page.locator(s).first().isVisible().catch(() => false)) return true;
  }
  return false;
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

  if (!(await booted(page))) fail.push(`${label}: โปรแกรมไม่เปิดขึ้น (ประตูหน้ายังอยู่ หรือไม่เห็นหน้าแรก)`);

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

  const started = await clickFirst(page, ["#homeBlank", "#blank"]);
  say(`เริ่มกริดเปล่าด้วย ${started}`);
  if (!started) { fail.push(`${label}: ไม่เจอปุ่มเริ่มกริดเปล่า`); await browser.close(); return; }
  await page.waitForTimeout(600);
  // ช่อง BPM ต้องบอกความเร็วจริงของกริด (เคยว่างทุกทางยกเว้นถอดจากไฟล์เสียง)
  const bpmField = await page.evaluate(() => (document.getElementById("bpm") || {}).value);
  say(`ช่อง BPM หลังเริ่มกริดเปล่า = ${JSON.stringify(bpmField)}`);
  if (!(+bpmField > 0)) fail.push(`${label}: ช่อง BPM ว่างหลังเริ่มกริดเปล่า`);
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

  // หยุดเล่นก่อน (ถ้ามี) แล้วเข้าหน้าส่งออกในรุ่นที่แยกหน้าไว้
  const toExp = await clickFirst(page, ["#toExport"]);
  if (toExp) { say("เข้าหน้าส่งออก"); await page.waitForTimeout(500); }
  for (const [ids, ext_, magic] of [[["#exMid2", "#exp"], "mid", "MThd"],
                                     [["#exXml2", "#expX"], "musicxml", "<?xml"]]) {
    const dl = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }).catch(() => null),
      clickFirst(page, ids),
    ]).then((r) => r[0]);
    if (!dl) { fail.push(`${label}: ส่งออก .${ext_} ไม่ได้ไฟล์`); say(`.${ext_}: ไม่มีไฟล์`); continue; }
    const p = path.join(require("os").tmpdir(), `smoke-${label}.${ext_}`);
    await dl.saveAs(p);
    const b = fs.readFileSync(p), head = b.slice(0, magic.length).toString("utf8");
    say(`ส่งออก .${ext_}: ${dl.suggestedFilename()} · ${b.length} B · ${head === magic ? "OK" : "ผิดรูปแบบ"}`);
    if (head !== magic) fail.push(`${label}: ไฟล์ .${ext_} ผิดรูปแบบ`);
  }

  // ถ้าอยู่หน้าส่งออก กลับมาหน้า editor ก่อน (รุ่น 11)
  if (toExp) {
    await clickFirst(page, ["#exBack", "#exClose", "#backEdit", '#exportScreen button:has-text("กลับ")']);
    await page.waitForTimeout(400);
  }
  /* รอจนนาฬิกาเดินเกิน 1 วินาที (ไม่เกิน 5 วินาที) แทนการรอตายตัว
     เครื่องเสียงของเบราว์เซอร์เปิดช้าเร็วไม่เท่ากัน รอตายตัว 1.2 วินาทีเคยตกทั้งที่โปรแกรมเล่นได้ */
  const t0 = Date.now();
  await page.click("#play").catch(() => {});
  const playStarted = await page.waitForFunction(() => {
    const el = document.querySelector(".clock"); return el && /0:0[1-9]|0:[1-9]/.test(el.textContent);
  }, null, { timeout: 5000, polling: 50 }).then(() => true).catch(() => false);
  const clock = await page.evaluate(() => {
    const el = document.querySelector(".clock"); return el ? el.textContent.trim() : ""; });
  say(`หลังกดเล่น: ${clock.replace(/\s+/g, " ")} · นาฬิกาเดินถึง 1 วินาทีใน ${Date.now() - t0}ms`);
  if (!playStarted) fail.push(`${label}: กดเล่นแล้วเวลาไม่เดินภายใน 5 วินาที`);
  await clickFirst(page, ["#stopb", "#stop"]);

  /* ---- หัวอ่าน: ลากไปวางแล้วกดเล่น ต้องเล่นต่อจากจุดนั้น ----
     ผู้ใช้ขอข้อนี้มาตรง ๆ ตั้งแต่แรก ล็อกไว้ไม่ให้หลุดตอนแก้ UI */
  const secs = (t) => { const m = /(\d+):(\d+(?:\.\d+)?)\s*$/.exec(t || ""); return m ? (+m[1]) * 60 + (+m[2]) : NaN; };
  const readClock = () => page.evaluate(() => ((document.querySelector("#clock") || {}).textContent || "").trim());
  await page.waitForTimeout(300);
  const gb = await page.locator("#grid").boundingBox();
  const hy = gb.y + 10, hx0 = gb.x + 170, hx1 = gb.x + Math.min(gb.width - 40, 520);   // แถบบนสุด 26px ของกริด = ที่จับหัวอ่าน
  await page.mouse.move(hx0, hy); await page.mouse.down();
  await page.mouse.move(hx1, hy, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(250);
  const headClock = await readClock(), tHead = secs(headClock);
  say(`ลากหัวอ่านไปที่: ${headClock}`);
  if (!(tHead > 0.2)) fail.push(`${label}: ลากหัวอ่านแล้วตำแหน่งไม่ขยับ (${headClock})`);
  await page.evaluate(() => {
    window.__lampOn = 0; const l = document.getElementById("kLamp");
    if (l) new MutationObserver(() => { if (l.classList.contains("on")) window.__lampOn++; }).observe(l, { attributes: true });
  });
  await page.click("#play").catch(() => {});
  await page.waitForTimeout(700);
  const runClock = await readClock(), tRun = secs(runClock);
  const lampOn = await page.evaluate(() => window.__lampOn);
  await clickFirst(page, ["#stopb", "#stop"]);
  say(`กดเล่นจากหัวอ่าน → ${runClock} · ไฟจังหวะกะพริบ ${lampOn} ครั้ง`);
  if (!(tRun >= tHead - 0.05 && tRun < tHead + 2.5))
    fail.push(`${label}: กดเล่นแล้วไม่ได้เริ่มจากหัวอ่าน (หัวอ่าน ${tHead}s แต่เล่นอยู่ที่ ${tRun}s)`);


  /* ---- ชื่อแถวต้องไม่ถูกตัด (เคยเหลือ "ไฮแฮ…" ทั้งเปิด/ปิด/เท้า แยกไม่ออก)
     และวงล้อซูมต้องอยู่ในช่องชื่อ ไม่ทับพื้นที่โน้ต ---- */
  const lab = await page.evaluate(() => {
    const cut = [...document.querySelectorAll("#labels .r .nm")].filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => n.textContent);
    const lw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--labelw")) || 132;
    const g = document.querySelector("#grid").getBoundingClientRect(), z = document.querySelector("#zwheel").getBoundingClientRect();
    return { cut, over: z.width > 0 && z.right > g.left + lw + 1, lw };
  });
  say(`ชื่อแถว: ช่องกว้าง ${lab.lw}px · ถูกตัด ${lab.cut.length ? lab.cut.join(", ") : "ไม่มี"} · วงล้อซูม${lab.over ? "ทับโน้ต" : "ไม่ทับโน้ต"}`);
  if (lab.cut.length) fail.push(`${label}: ชื่อแถวถูกตัด ${lab.cut.join(", ")}`);
  if (lab.over) fail.push(`${label}: วงล้อซูมทับพื้นที่โน้ต`);

  /* ---- ช่วงวนซ้ำ: ลากบนแถบไม้บรรทัด (ใต้แถบเลขห้อง y 46–74) แล้วเล่นต้องวนอยู่ในช่วงนั้น
     ผู้ใช้ขอให้ตั้งวนซ้ำด้วยการลากคลุมบนไทม์ไลน์แทนการกดปุ่ม ---- */
  await page.evaluate(() => { const g = document.getElementById("gs"); if (g) g.scrollLeft = 0; });
  await page.waitForTimeout(200);
  const gb2 = await page.locator("#grid").boundingBox();
  const ly = gb2.y + 46 + 14, lx0 = gb2.x + 150, lx1 = gb2.x + Math.min(gb2.width - 80, 420);
  await page.mouse.move(lx0, ly); await page.mouse.down();
  await page.mouse.move(lx1, ly, { steps: 10 }); await page.mouse.up();
  await page.waitForTimeout(250);
  const loopMsg = await page.evaluate(() => document.querySelector("#status").textContent);
  const loopN = +((/·\s*([\d.]+)\s*จังหวะ/.exec(loopMsg) || [])[1]);
  const bpmNow = +(await page.evaluate(() => document.getElementById("bpm").value)) || 120;
  const loopA = secs(await readClock()), loopB = loopA + loopN * 60 / bpmNow;
  say(`ลากตั้งวนซ้ำ → ${loopMsg.split(" — ")[0]} (${loopA.toFixed(2)}–${loopB.toFixed(2)} วิ)`);
  if (!(loopN > 0)) fail.push(`${label}: ลากบนไม้บรรทัดแล้วไม่ได้ตั้งช่วงวนซ้ำ (${loopMsg})`);
  else {
    await page.click("#play").catch(() => {});
    const seen = [];
    for (let k = 0; k < 10; k++) { await page.waitForTimeout(250); seen.push(secs(await readClock())); }
    await clickFirst(page, ["#stopb", "#stop"]);
    const out = seen.filter((t) => !(t >= loopA - 0.06 && t <= loopB + 0.06));
    say(`เล่นในช่วงวนซ้ำ: ${seen.map((t) => t.toFixed(2)).join(" ")}`);
    if (out.length) fail.push(`${label}: เล่นหลุดออกนอกช่วงวนซ้ำ (${out.join(", ")})`);
    await page.mouse.click((lx0 + lx1) / 2, ly); await page.waitForTimeout(200);
    const clr = await page.evaluate(() => document.querySelector("#status").textContent);
    if (!/ยกเลิกช่วงวนซ้ำ/.test(clr)) fail.push(`${label}: แตะในช่วงแล้วไม่ยกเลิกวนซ้ำ (${clr})`);
  }

  /* ---- ย่อแถบล่าง: ต้องเตี้ยลงจริง (เคยกดแล้วไม่มีอะไรยุบ) และแผงเขียนโน้ตลอยต้องเลือกค่าโน้ตได้ ---- */
  const tpH0 = (await page.locator("#tp").boundingBox()).height;
  await page.click("#tpToggle"); await page.waitForTimeout(300);
  const tpH1 = (await page.locator("#tp").boundingBox()).height;
  const palOn = await page.isVisible("#npal");
  say(`ย่อแถบล่าง: ${Math.round(tpH0)}px → ${Math.round(tpH1)}px · แผงเขียนโน้ต${palOn ? "ขึ้น" : "ไม่ขึ้น"}`);
  if (!(tpH1 < 80 && tpH1 < tpH0 - 100)) fail.push(`${label}: กดย่อแถบล่างแล้วไม่เตี้ยลง (${Math.round(tpH0)} → ${Math.round(tpH1)}px)`);
  if (!palOn) fail.push(`${label}: ย่อแถบล่างแล้วแผงเขียนโน้ตไม่ขึ้น`);
  else {
    await page.locator("#npal .np-vals button").nth(3).click();
    await page.waitForTimeout(150);
    const pressed = await page.evaluate(() => document.querySelectorAll("#vals button")[3].getAttribute("aria-pressed"));
    if (pressed !== "true") fail.push(`${label}: กดค่าโน้ตในแผงลอยแล้วปุ่มเดิมไม่ถูกเลือก`);
  }
  await page.click("#tpToggle"); await page.waitForTimeout(300);     // กลับเป็นแถบเต็มให้ขั้นต่อไปหาปุ่มเจอ
  if (await page.isVisible("#npal")) fail.push(`${label}: ขยายแถบล่างแล้วแผงลอยยังค้างอยู่`);
  /* ---- ธีมมิดเซนจูรี่ ---- */
  const th = await page.evaluate(() => {
    const kt = window.KlongTheme; if (!kt) return null;
    const off = document.createElement("canvas").getContext("2d"); off.fillStyle = "#1F1B19";   // แบบ canvas ส่งออก
    const on = document.querySelector("#grid").getContext("2d"), keep = on.fillStyle;
    on.fillStyle = "#1F1B19"; const onV = on.fillStyle; on.fillStyle = keep;
    return { mode: document.documentElement.dataset.kmode, unmapped: [...kt.unmapped], off: off.fillStyle, on: onV,
             lamp: !!document.getElementById("kLamp"), vu: !!document.getElementById("kVu"), sw: !!document.getElementById("kMode") };
  });
  if (!th) fail.push(`${label}: ธีมไม่โหลด`);
  else {
    say(`ธีม: โหมด=${th.mode} · สีหลุดธีม=${th.unmapped.length ? th.unmapped.join(",") : "ไม่มี"} · canvas ส่งออก=${th.off} · canvas บนจอ=${th.on}`);
    if (th.unmapped.length) fail.push(`${label}: มีสีบนจอที่ธีมยังไม่รู้จัก ${th.unmapped.join(", ")}`);
    if (th.off !== "#1f1b19") fail.push(`${label}: canvas ส่งออกโดนแปลงสี (${th.off})`);
    if (th.on === "#1f1b19") fail.push(`${label}: canvas บนจอไม่ถูกแปลงสี`);
    if (!th.lamp || !th.vu || !th.sw) fail.push(`${label}: ไฟจังหวะ/มาตรวัด/สวิตช์แสง ไม่ครบ`);
    if (!(lampOn > 0)) fail.push(`${label}: ไฟจังหวะไม่กะพริบตอนเล่น`);
    /* นาฬิกาต้องกว้างคงที่ทุกค่าเวลา ไม่งั้นปุ่มทั้งแถวสั่นตอนเล่น (เคยเกิดกับฟอนต์ Prompt)
       ป้อนข้อความแบบที่โปรแกรมเขียนจริง 0:00.00 ถึง 0:12.00 แล้ววัดทุกค่า คืนข้อความเดิมตอนจบ */
    const cw = await page.evaluate(async () => {
      const c = document.getElementById("clock"), keep = c.textContent, ws = new Set();
      const fmt = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return m + ":" + (s < 10 ? "0" : "") + s.toFixed(2); };
      for (let i = 0; i <= 1200; i += 7) {
        const t = i / 100;
        c.textContent = "ห้อง " + (1 + Math.floor(t / 2)) + " · จังหวะ " + (1 + Math.floor(t * 2) % 4) + " · " + fmt(t);
        await new Promise((r) => requestAnimationFrame(r));
        ws.add(Math.round(c.getBoundingClientRect().width * 10) / 10);
      }
      c.textContent = keep; return [...ws];
    });
    say(`ความกว้างนาฬิกาตลอด 12 วินาที: ${cw.join(", ")}px`);
    if (cw.length !== 1) fail.push(`${label}: นาฬิกาเปลี่ยนความกว้างตามตัวเลข ${cw.length} แบบ ปุ่มข้าง ๆ จะสั่นตอนเล่น`);
    /* แถบสถานะของ iPad (เวลา แบต) ต้องไม่ทับแถบบน และพื้นที่ทำงานต้องเริ่มใต้แถบพอดี
       จำลองแถบสถานะสูง 33px แบบ iPad 11 นิ้วที่เปิดจากหน้าโฮม แล้วคืนค่าเดิม */
    const edge = await page.evaluate(async () => {
      const st = document.createElement("style"); st.textContent = ":root{--sat:33px !important}";
      document.head.appendChild(st);
      await new Promise((r) => setTimeout(r, 250));
      const tb = document.getElementById("topbar").getBoundingClientRect();
      const kids = [...document.querySelectorAll("#topbar > *")].filter((e) => e.offsetParent)
        .map((e) => e.getBoundingClientRect().top);
      const mw = document.querySelector("main.wrap").getBoundingClientRect().top;
      st.remove(); await new Promise((r) => setTimeout(r, 250));
      return { firstTop: Math.round(Math.min(...kids)), tbBottom: Math.round(tb.bottom), mainTop: Math.round(mw) };
    });
    say(`แถบสถานะ 33px: ปุ่มบนสุดเริ่มที่ ${edge.firstTop}px · แถบบนสิ้นสุด ${edge.tbBottom}px · พื้นที่ทำงานเริ่ม ${edge.mainTop}px`);
    if (edge.firstTop < 33) fail.push(`${label}: แถบสถานะ iPad ทับปุ่มแถบบน (ปุ่มเริ่มที่ ${edge.firstTop}px)`);
    if (Math.abs(edge.mainTop - edge.tbBottom) > 1) fail.push(`${label}: พื้นที่ทำงานไม่ได้เริ่มใต้แถบบนพอดี (${edge.mainTop} กับ ${edge.tbBottom})`);
    const bgOf = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const before = await bgOf();
    await page.click('#kMode button[data-mode="night"]');
    await page.waitForTimeout(400);
    const n = await page.evaluate(() => ({ mode: document.documentElement.dataset.kmode, unmapped: [...window.KlongTheme.unmapped] }));
    const after = await bgOf();
    say(`สลับเป็นกลางคืน: โหมด=${n.mode} · พื้น ${before} → ${after}`);
    if (n.mode !== "night" || before === after) fail.push(`${label}: สลับเป็นกลางคืนไม่ได้`);
    if (n.unmapped.length) fail.push(`${label}: โหมดกลางคืนมีสีหลุดธีม ${n.unmapped.join(", ")}`);
    await page.click('#kMode button[data-mode="auto"]');
    await page.waitForTimeout(200);
  }

  /* ---- เสียงกลองจริง (sounds/) ----
     ชุดอะคูสติกต้องโหลดครบ ทุกเสียงของโปรแกรมต้องได้เสียงจริง (ยกเว้นครอสสติ๊กที่ไม่มีไฟล์)
     เสียงต้องเริ่มตรงเวลาที่ตั้ง (ไฟล์ MP3 มีช่วงเงียบหัวไฟล์ 7-25 ms ตัวเล่นต้องตัดให้)
     ไฮแฮตเปิดต้องถูกตัดเมื่อเหยียบ และปุ่มทดสอบเสียงของโปรแกรมต้องวิ่งผ่านทางเข้าใน playVoice */
  const snd = await page.evaluate(async () => {
    const K = window.KlongSounds; if (!K) return null;
    await K.setKit("acoustic");
    const st = K.state();
    const keys = ["kick","snare","snare:rim","hihat","hihat:open","hhf","tom1","tom2","floor",
                  "crash","crash2","ride","bell","china","splash","cow"];
    const bad = [], late = [];
    const render = async (fn, sec) => {
      const oc = new OfflineAudioContext(2, Math.round(44100 * sec), 44100);
      const sink = oc.createGain(); sink.connect(oc.destination);
      const ok = fn(oc, sink); if (!ok) return null;
      return oc.startRendering();
    };
    for (const k of keys) {
      const b = await render((oc, sink) => K.play(oc, sink, k, 0.1, 100), 0.6);
      if (!b) { bad.push(k); continue; }
      const L = b.getChannelData(0), R = b.getChannelData(1);
      let pk = 0; for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
      if (pk < 0.01) { bad.push(k + "(เงียบ)"); continue; }
      let on = 0; for (let i = 0; i < L.length; i++) if (Math.max(Math.abs(L[i]), Math.abs(R[i])) >= pk * 0.02) { on = i; break; }
      const ms = (on / 44100 - 0.1) * 1000; if (ms < -0.5 || ms > 3) late.push(k + " " + ms.toFixed(1) + "ms");
    }
    const tail = async (close) => {
      const b = await render((oc, sink) => { K.play(oc, sink, "hihat:open", 0.1, 100);
        if (close) K.play(oc, sink, "hhf", 0.4, 1); return true; }, 1.5);
      const L = b.getChannelData(0); let e = 0; for (let i = Math.round(0.47 * 44100); i < L.length; i++) e += L[i] * L[i]; return e; };
    const chokeDb = 10 * Math.log10((await tail(true) + 1e-12) / (await tail(false) + 1e-12));
    const xo = new OfflineAudioContext(1, 441, 44100), xs = xo.createGain();
    const cross = K.play(xo, xs, "snare:cross", 0, 100);
    const before = K.stats.played;
    document.getElementById("testSnd").click();
    await new Promise((r) => setTimeout(r, 300));
    const btns = [...document.querySelectorAll("#kKit button")];
    return { ready: st.ready, loaded: st.loaded, total: st.total, failed: st.failed, bad, late,
      chokeDb: Math.round(chokeDb), cross, viaApp: K.stats.played - before, btns: btns.length,
      pressed: (btns.find((b) => b.getAttribute("aria-pressed") === "true") || {}).textContent || "",
      credit: (document.getElementById("kKitCr") || {}).textContent || "" };
  });
  if (!snd) fail.push(`${label}: ตัวเล่นเสียงกลองจริงไม่โหลด`);
  else {
    say(`เสียงจริง: ชุด=${snd.pressed} โหลด ${snd.loaded}/${snd.total} พลาด ${snd.failed} · ไม่มีเสียง=${snd.bad.join(",") || "ไม่มี"} · เริ่มช้า=${snd.late.join(",") || "ไม่มี"} · ไฮแฮตถูกตัด ${snd.chokeDb} dB · ผ่าน playVoice ${snd.viaApp} เสียง`);
    if (!snd.ready || snd.failed) fail.push(`${label}: โหลดชุดเสียงอะคูสติกไม่ครบ (${snd.loaded}/${snd.total} พลาด ${snd.failed})`);
    if (snd.bad.length) fail.push(`${label}: เสียงเหล่านี้ไม่ได้เสียงจริง ${snd.bad.join(", ")}`);
    if (snd.late.length) fail.push(`${label}: เสียงจริงเริ่มไม่ตรงเวลา ${snd.late.join(", ")}`);
    if (!(snd.chokeDb < -20)) fail.push(`${label}: เหยียบไฮแฮตแล้วไฮแฮตเปิดไม่ถูกตัด (${snd.chokeDb} dB)`);
    if (snd.cross !== false) fail.push(`${label}: ครอสสติ๊กควรเล่นเสียงสังเคราะห์ (ไม่มีไฟล์)`);
    if (snd.viaApp < 4) fail.push(`${label}: ปุ่มทดสอบเสียงไม่ได้ผ่านเสียงจริง (${snd.viaApp}/4) ทางเข้าใน playVoice หาย?`);
    if (snd.btns !== 6 || !/Alexander Holm/.test(snd.credit)) fail.push(`${label}: ปุ่มเลือกชุดเสียงหรือเครดิตชุดอะคูสติกไม่ครบ`);
  }

  await ctx.setOffline(true);
  await page.goto(BASE, { waitUntil: "load" })
    .catch((e) => fail.push(`${label}: โหลดตอนออฟไลน์ไม่ได้ ${e.message}`));
  await page.waitForTimeout(1200);
  const offOk = await booted(page);
  const offFont = await page.evaluate(async () => { await document.fonts.ready;
    return [...document.fonts].some((f) => f.family.includes("IBM Plex Sans Thai") && f.status === "loaded"); });
  say(`ออฟไลน์: เปิดได้=${offOk} ฟอนต์มา=${offFont}`);
  if (!offOk) fail.push(`${label}: ออฟไลน์แล้วโปรแกรมไม่ขึ้น`);
  if (!offFont) fail.push(`${label}: ออฟไลน์แล้วฟอนต์ไม่มา`);
  const offSnd = await page.waitForFunction(() => window.KlongSounds && window.KlongSounds.state().ready &&
    window.KlongSounds.state().kit === "acoustic", null, { timeout: 20000 }).then(() => true, () => false);
  const offSt = await page.evaluate(() => window.KlongSounds ? window.KlongSounds.state() : null);
  say(`ออฟไลน์: เสียงจริงพร้อม=${offSnd} (${offSt ? offSt.loaded + "/" + offSt.total + " พลาด " + offSt.failed : "-"})`);
  if (!offSnd || (offSt && offSt.failed)) fail.push(`${label}: ออฟไลน์แล้วเสียงกลองจริงไม่มา`);
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
