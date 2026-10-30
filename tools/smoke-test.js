#!/usr/bin/env node
/* ตรวจเว็บแอปด้วยเบราว์เซอร์จริง ก่อน push ทุกครั้งที่อัปเดตไฟล์ HTML
 *
 *   npm i playwright && node tools/smoke-test.js
 *
 * เสิร์ฟโปรเจกต์ใต้ /T/ เลียนแบบ GitHub Pages แล้วเปิดด้วย Chromium
 * ทั้งขนาดจอ iPad, iPhone และ Android (S Pen) ตรวจว่า
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
  ".mp3":"audio/mpeg", ".jpg":"image/jpeg" };

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

/* จอมือถือ (data-kphone): ส่งออก ตั้งค่า นำเข้า โหมด อยู่แถวที่สองของแถบบน ต้องกด ⋯ ก่อน */
async function showTopMore(page) {
  if (await page.locator("#toExport").isVisible().catch(() => false)) return;
  if (await page.locator("#kTbMore").isVisible().catch(() => false)) { await page.click("#kTbMore"); await page.waitForTimeout(200); }
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
  await showTopMore(page);
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

  /* โน้ตพิมพ์ (PDF): ต้องเป็น PDF จริง ภาพไม่สูญเสีย (FlateDecode ไม่ใช่ JPEG ที่เส้นเป็นฝ้า)
     และหน้าตัวอย่างต้องเป็นกระดาษขาว มีหมึกดำ (ไม่ใช่พื้นมืดกลับสีแบบเดิม) */
  if (toExp) {
    const dlPdf = await Promise.all([
      page.waitForEvent("download", { timeout: 30000 }).catch(() => null),
      clickFirst(page, ["#exPdf"]),
    ]).then((r) => r[0]);
    if (!dlPdf) fail.push(`${label}: ส่งออก PDF ไม่ได้ไฟล์`);
    else {
      const p = path.join(require("os").tmpdir(), `smoke-${label}.pdf`);
      await dlPdf.saveAs(p);
      const b = fs.readFileSync(p), txt = b.toString("latin1");
      const ok = txt.startsWith("%PDF-") && /%%EOF\s*$/.test(txt), flate = /\/FlateDecode/.test(txt);
      say(`ส่งออก PDF: ${b.length} B · ${ok ? "OK" : "ผิดรูปแบบ"} · ${flate ? "ภาพไม่สูญเสีย" : "JPEG"}`);
      if (!ok) fail.push(`${label}: ไฟล์ PDF ผิดรูปแบบ`);
      if (!flate) fail.push(`${label}: PDF ยังเป็นภาพ JPEG`);
    }
    await clickFirst(page, ["#exPrev"]); await page.waitForTimeout(800);
    const pv = await page.evaluate(async () => {
      const im = document.querySelector("#exPreview img"); if (!im) return null;
      await im.decode().catch(() => {});
      const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight;
      const g = c.getContext("2d"); g.drawImage(im, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data; let white = 0, black = 0, mid = 0;
      for (let i = 0; i < d.length; i += 16) { const l = d[i]; if (l > 245) white++; else if (l < 60) black++; else mid++; }
      const n = white + black + mid; return { white: white / n, black: black / n };
    });
    say(`ตัวอย่างโน้ตพิมพ์: กระดาษขาว ${pv ? Math.round(pv.white * 100) : "-"}% · หมึกดำ ${pv ? (pv.black * 100).toFixed(1) : "-"}%`);
    if (!pv || pv.white < 0.85 || pv.black < 0.0008) fail.push(`${label}: ตัวอย่างโน้ตพิมพ์ไม่ใช่หมึกดำบนกระดาษขาว`);
    /* ตั้งค่าหน้ากระดาษ: กระดาษกำหนดเอง 200×250 มม. แนวตั้ง → PDF ต้องได้ขนาดนั้นจริง (567×709 pt)
       ค่าต้องจำไว้ในเครื่อง · ตัวอย่างต้องวาดใหม่เองเมื่อแก้ค่า แล้วคืนค่าเริ่มต้นก่อนทำขั้นต่อไป */
    await page.evaluate(() => {
      const set = (id, v) => { const e = document.getElementById(id); if (e.type === "checkbox") e.checked = v; else e.value = v;
        e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); };
      set("exPaper", "custom"); set("exPW", "200"); set("exPH", "250"); set("exOrient", "p");
      set("exStaff", "6"); set("exPerSys", "0"); set("exComp", "ทดสอบ");
    });
    await page.waitForTimeout(900);
    const dl2 = await Promise.all([
      page.waitForEvent("download", { timeout: 30000 }).catch(() => null),
      clickFirst(page, ["#exPdf"]),
    ]).then((r) => r[0]);
    let box = "";
    if (dl2) { const p2 = path.join(require("os").tmpdir(), `smoke-${label}-custom.pdf`); await dl2.saveAs(p2);
      box = ((/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(fs.readFileSync(p2).toString("latin1")) || []).slice(1).join("×")); }
    const saved = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem("klongpro.print")) || {}; } catch (e) { return {}; } });
    const pages = await page.evaluate(() => document.getElementById("exPages").textContent);
    say(`ตั้งค่าหน้ากระดาษ: กระดาษ 200×250 มม. → PDF ${box} pt · จำค่า=${saved.paper}/${saved.staffMM} มม. · ${pages}`);
    if (box !== "566.93×708.66") fail.push(`${label}: กระดาษกำหนดเองไม่ได้ขนาดตามที่ตั้ง (${box})`);
    if (saved.paper !== "custom" || +saved.staffMM !== 6) fail.push(`${label}: ไม่ได้จำค่าตั้งหน้ากระดาษไว้`);
    if (!/\d+ หน้า/.test(pages)) fail.push(`${label}: ตัวอย่างไม่วาดใหม่ตามค่าที่แก้`);
    await clickFirst(page, ["#exReset"]); await page.waitForTimeout(500);
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

  /* ---- หัวอ่าน: แตะหัวกริดตั้งจุดเล่นแล้วกดเล่น ต้องเล่นต่อจากจุดนั้น ----
     ผู้ใช้ขอข้อนี้มาตรง ๆ ตั้งแต่แรก ล็อกไว้ไม่ให้หลุดตอนแก้ UI
     หัวกริดเป็นแถบเดียว (สูง 54px): แตะ = จุดเล่น · ลาก = วนซ้ำ (ผู้ใช้ขอให้รวมไว้ที่เดียว) */
  const secs = (t) => { const m = /(\d+):(\d+(?:\.\d+)?)\s*$/.exec(t || ""); return m ? (+m[1]) * 60 + (+m[2]) : NaN; };
  const readClock = () => page.evaluate(() => ((document.querySelector("#clock") || {}).textContent || "").trim());
  await page.waitForTimeout(300);
  const gb = await page.locator("#grid").boundingBox();
  const hy = gb.y + 12, hx1 = gb.x + Math.min(gb.width - 40, 520);
  await page.mouse.click(hx1, hy);
  await page.waitForTimeout(250);
  const headClock = await readClock(), tHead = secs(headClock);
  say(`แตะหัวกริดตั้งจุดเล่น: ${headClock}`);
  if (!(tHead > 0.2)) fail.push(`${label}: แตะหัวกริดแล้วจุดเล่นไม่ขยับ (${headClock})`);
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

  /* ---- ช่วงวนซ้ำ: ลากบนหัวกริด (ไม้บรรทัด y 26–54) แล้วเล่นต้องวนอยู่ในช่วงนั้น
     ผู้ใช้ขอให้ตั้งวนซ้ำด้วยการลากคลุมบนไทม์ไลน์แทนการกดปุ่ม · แตะในช่วง = จุดเล่น · ✕ ท้ายช่วง = ยกเลิก ---- */
  await page.evaluate(() => { const g = document.getElementById("gs"); if (g) g.scrollLeft = 0; });
  await page.waitForTimeout(200);
  const gb2 = await page.locator("#grid").boundingBox();
  const ly = gb2.y + 26 + 14, lx0 = gb2.x + 150, lx1 = gb2.x + Math.min(gb2.width - 80, 420);
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
    // แตะในช่วง = ย้ายจุดเล่น ช่วงยังอยู่
    await page.mouse.click((lx0 + lx1) / 2, ly); await page.waitForTimeout(200);
    const inMsg = await page.evaluate(() => document.querySelector("#status").textContent), tIn = secs(await readClock());
    // ✕ ท้ายช่วง: หาจากภาพบนผืนผ้าใบ — วงสีฟ้าอมเขียวขวาสุดในแถวกลางไม้บรรทัด
    const chipX = await page.evaluate((y) => { const c = document.getElementById("grid"), r = c.getBoundingClientRect(), k = c.width / r.width;
      const row = c.getContext("2d").getImageData(0, Math.round((y - r.top) * k), c.width, 1).data; let mx = -1;
      for (let i = 0; i < c.width; i++) { const R = row[i * 4], G = row[i * 4 + 1], B = row[i * 4 + 2]; if (G > R + 35 && B > R + 25) mx = i; }
      return mx < 0 ? null : r.left + mx / k - 9; }, ly);
    if (chipX) { await page.mouse.click(chipX, ly); await page.waitForTimeout(200); }
    const clr = await page.evaluate(() => document.querySelector("#status").textContent);
    say(`แตะในช่วง → จุดเล่น ${tIn.toFixed(2)} วิ (ช่วงยังอยู่ ${!/ยกเลิกช่วงวนซ้ำแล้ว|ออกจากช่วงวนซ้ำ/.test(inMsg)}) · แตะ ✕ → ${clr.split(" — ")[0]}`);
    if (!(tIn >= loopA - 0.06 && tIn <= loopB + 0.06) || /ยกเลิกช่วงวนซ้ำแล้ว|ออกจากช่วงวนซ้ำ/.test(inMsg)) fail.push(`${label}: แตะในช่วงวนซ้ำแล้วไม่ได้ย้ายจุดเล่น หรือไปยกเลิกช่วง`);
    if (!/ยกเลิกช่วงวนซ้ำ/.test(clr)) fail.push(`${label}: แตะ ✕ ท้ายช่วงแล้วไม่ยกเลิกวนซ้ำ (${clr})`);
  }

  /* ---- นิ้วบนไม้บรรทัด ด้วยเครื่องมือ "เลื่อน" ที่เป็นค่าเริ่มต้น
     ผู้ใช้เจอบน iPad: ลากแล้วขาดกลางทาง จอเลื่อนแทน และขึ้นแว่นเลือกข้อความ
     เพราะเครื่องมือเลื่อนตั้ง touch-action เป็น pan-x pan-y เบราว์เซอร์จึงยึดนิ้วไปเลื่อนจอ
     เคสเมาส์ด้านบนจับไม่ได้ จึงลากด้วยนิ้วจริง (CDP) ไม้บรรทัดต้องตั้งวนซ้ำได้โดยจอไม่เลื่อน
     แถบบนสุดต้องลากหัวอ่านได้ ส่วนตัวกริดยังต้องปัดเลื่อนจอได้ตามเดิม ---- */
  await page.click('#tool button[data-v="pan"]');
  await page.evaluate(() => { document.getElementById("gs").scrollLeft = 0;
    window.__pcancel = 0; document.getElementById("grid").addEventListener("pointercancel", () => window.__pcancel++); });
  await page.waitForTimeout(200);
  const cdp = await ctx.newCDPSession(page);
  const finger = async (xa, xb, y) => {
    const tp = (x) => [{ x, y, id: 1, radiusX: 5, radiusY: 5, force: 1 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: tp(xa) }); await page.waitForTimeout(60);
    for (let i = 1; i <= 14; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: tp(xa + (xb - xa) * i / 14) }); await page.waitForTimeout(25); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await page.waitForTimeout(300);
    return page.evaluate(() => ({ sl: document.getElementById("gs").scrollLeft, pc: window.__pcancel,
      st: document.querySelector("#status").textContent, clock: document.getElementById("clock").textContent }));
  };
  const gb3 = await page.locator("#grid").boundingBox();
  const lw3 = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--labelw")) || 132);
  const fx0 = gb3.x + lw3 + 50, fx1 = Math.min(gb3.x + gb3.width - 40, fx0 + 220);
  const fr = await finger(fx1, fx0, gb3.y + 26 + 14);                   // ไม้บรรทัด ลากจากขวาไปซ้าย
  say(`นิ้วบนไม้บรรทัด (เครื่องมือเลื่อน): ${fr.st.split(" — ")[0]} · จอเลื่อน ${Math.round(fr.sl)}px · ลากขาด ${fr.pc} ครั้ง`);
  if (!/วนซ้ำ/.test(fr.st) || fr.pc || fr.sl > 2)
    fail.push(`${label}: ลากไม้บรรทัดด้วยนิ้วไม่ได้ (จอเลื่อน ${Math.round(fr.sl)}px · ลากขาด ${fr.pc} · ${fr.st})`);
  const clk0 = await readClock();
  // นิ้วแตะหัวกริด (บรรทัดเลขห้อง) นอกช่วง = จุดเล่นใหม่ + เลิกวนซ้ำ · จอต้องไม่เลื่อน
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: fx1 + 30, y: gb3.y + 12, id: 1 }] }); await page.waitForTimeout(60);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await page.waitForTimeout(300);
  const fh = await page.evaluate(() => ({ sl: document.getElementById("gs").scrollLeft, pc: window.__pcancel,
    st: document.querySelector("#status").textContent, clock: document.getElementById("clock").textContent }));
  if (fh.clock === clk0 || fh.pc > fr.pc || Math.abs(fh.sl - fr.sl) > 2 || !/ออกจากช่วงวนซ้ำ/.test(fh.st))
    fail.push(`${label}: นิ้วแตะหัวกริดแล้วจุดเล่นไม่ย้าย/ไม่เลิกวนซ้ำ (จอเลื่อน ${Math.round(fh.sl - fr.sl)}px · ${fh.st})`);
  const rowY = await page.evaluate(() => { const r = document.querySelector("#labels .r").getBoundingClientRect(); return r.top + r.height / 2; });
  const fg = await finger(fx1, fx0, rowY);                              // ตัวกริด = ปัดเลื่อนจอ
  say(`นิ้วแตะหัวกริด: ${clk0} → ${fh.clock} · ${fh.st.split(" — ")[0]} · นิ้วปัดตัวกริด: จอเลื่อน ${Math.round(fg.sl - fh.sl)}px`);
  if (!(fg.sl - fh.sl > 50)) fail.push(`${label}: เครื่องมือเลื่อนปัดเลื่อนกริดด้วยนิ้วไม่ได้แล้ว (${Math.round(fg.sl - fh.sl)}px)`);
  await page.evaluate(() => { document.getElementById("gs").scrollLeft = 0; });
  await page.click('#tool button[data-v="draw"]');

  /* ---- ย่อแถบล่าง: ต้องเตี้ยลงจริง (เคยกดแล้วไม่มีอะไรยุบ) และแผงเขียนโน้ตลอยต้องเลือกค่าโน้ตได้ ---- */
  // มือถือเริ่มแบบย่อ (ดู phoneSuite) — ขยายก่อน แล้วทดสอบการย่อเหมือนจอใหญ่
  if (await page.evaluate(() => document.getElementById("tp").classList.contains("min"))) {
    await page.click("#tpToggle"); await page.waitForTimeout(300);
  }
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
    /* แถบห้องท้ายแผง: คัดลอก / วาง / ซ้ำห้องก่อนหน้า ต้องเห็นเสมอ เป้านิ้ว 44px และกดแล้วไปกดปุ่มเดิมจริง
       (แผงที่เกาะขอบจอบนมือถือ แถบห้องเป็นหมวด "ห้อง") */
    if (await page.evaluate(() => document.getElementById("npal").classList.contains("docked"))) {
      await page.click('#npal .np-tabs button[data-cat="bar"]'); await page.waitForTimeout(150);
    }
    const nb = await page.evaluate(() => {
      const bs = [...document.querySelectorAll("#npal .np-bar-b button")].map((b) => b.getBoundingClientRect());
      return { n: bs.length, minH: Math.min(...bs.map((r) => r.height)), inView: bs.every((r) => r.bottom <= innerHeight && r.top >= 0) };
    });
    await page.click('#npal .np-bar-b button[data-for="barCopy"]'); await page.waitForTimeout(150);
    const nbCopy = await page.evaluate(() => document.getElementById("npBarInfo").textContent);
    await page.click('#npal .np-bar-b button[data-for="barDup"]'); await page.waitForTimeout(150);
    const nbDup = await page.evaluate(() => document.getElementById("npBarInfo").textContent);
    say(`แผงลอย แถบห้อง: ${nb.n} ปุ่ม สูง ${Math.round(nb.minH)}px · คัดลอก → ${nbCopy} · ซ้ำห้องก่อนหน้า → ${nbDup}`);
    if (nb.n !== 3 || nb.minH < 44 || !nb.inView) fail.push(`${label}: แถบห้องในแผงลอยไม่ครบ/เล็กกว่า 44px/หลุดจอ`);
    if (!/✓ คัดลอกห้อง \d+ แล้ว/.test(nbCopy)) fail.push(`${label}: ปุ่มคัดลอกห้องในแผงลอยไม่ทำงาน (${nbCopy})`);
    if (!/^[✓⚠]/.test(nbDup) || nbDup === nbCopy) fail.push(`${label}: ปุ่มซ้ำห้องก่อนหน้าในแผงลอยไม่ตอบสนอง (${nbDup})`);
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

/* ---- iPad: ช่องแรกของกริด · แถบเสียงตอนย่อ · แก้โน้ตระหว่างเล่นวนซ้ำ (ผู้ใช้ขอหลังลองบน iPad) ----
   ช่องแรกเคยห่างปุ่ม S แค่ ~6px แตะแล้วโดนปุ่ม · แถบเสียงเพลง/กลองต้องอยู่ในแถวเล่นตอนย่อ
   วางโน้ตระหว่างวนซ้ำห้องเดิมต้องดังรอบถัดไปเลย (เดิมต้องหยุดแล้วเล่นใหม่) */
async function editSuite(label, exe) {
  const browser = await chromium.launch({ executablePath: exe, args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ ...devices["iPad Pro 11 landscape"], hasTouch: true, isMobile: false });
  await ctx.addInitScript(() => { try { localStorage.setItem("klongpro.tpmin", "1"); localStorage.setItem("klongpro.insp", "0"); } catch (e) {} });
  const page = await ctx.newPage(); const errs = [];
  page.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
  const say = (t) => console.log(`[${label}] ${t}`);
  await page.goto(BASE, { waitUntil: "load" }); await page.waitForTimeout(500);
  await page.click("#homeBlank"); await page.waitForTimeout(600);
  await page.click('#tool button[data-v="draw"]');
  const g = await page.evaluate(() => { const lw = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--labelw"));
    const c = document.getElementById("grid").getBoundingClientRect(), sb = document.querySelector("#labels .r .so").getBoundingClientRect();
    const row = (re) => { const r = [...document.querySelectorAll("#labels .r")].find((x) => re.test(x.textContent)).getBoundingClientRect(); return r.top + r.height / 2; };
    return { first: c.left + lw + 28, sRight: sb.right, snare: row(/สแนร์/), kick: row(/กระเดื่อง/) }; });
  const count = () => page.evaluate(() => +((/ตัวโน้ตรวม\s*(\d+)/.exec(document.getElementById("stats").textContent) || [])[1] || 0));
  await page.touchscreen.tap(g.first, g.snare); await page.waitForTimeout(150); const c1 = await count();
  await page.touchscreen.tap(g.first - 18, g.snare); await page.waitForTimeout(150); const c2 = await count();
  await page.touchscreen.tap(g.first, g.snare); await page.waitForTimeout(150); const c3 = await count();
  say(`ช่องแรกของกริดห่างปุ่ม S ${Math.round(g.first - g.sRight)}px · แตะช่องแรก ${c1} ตัว · แตะช่องว่างข้างหน้า (ช่องเดิม) ${c2} · แตะอีกครั้ง ${c3}`);
  if (g.first - g.sRight < 24) fail.push(`${label}: ช่องแรกของกริดชิดปุ่ม S เกินไป (${Math.round(g.first - g.sRight)}px)`);
  if (c1 !== 1 || c2 !== 0 || c3 !== 1) fail.push(`${label}: แตะช่องแรก/ช่องว่างหน้าห้อง 1 ไม่ถูกต้อง (${c1}/${c2}/${c3}) — ต้องวาง ลบ วาง ไม่ซ้อนตัว`);
  const mix = await page.evaluate(() => { const m = document.getElementById("tpMix"), r = m.getBoundingClientRect(), d = m.querySelector('input[data-for="dvol"]');
    const on = getComputedStyle(m).display !== "none" && r.width > 150 && r.bottom <= innerHeight;
    d.value = "31"; d.dispatchEvent(new Event("input")); const to = document.getElementById("dvol").value;
    const o = document.getElementById("vol"); o.value = "42"; o.dispatchEvent(new Event("input"));
    const back = m.querySelector('input[data-for="vol"]').value; d.value = "65"; d.dispatchEvent(new Event("input"));
    return { on, to, back }; });
  say(`แถบเสียงตอนย่อ: เห็น ${mix.on} · เลื่อนกลอง → ตัวจริง ${mix.to} · ตัวจริงเพลง 42 → สำเนา ${mix.back}`);
  /* แถบล่างแบบย่อ: ปุ่ม ▴ ต้องตรงแถวปุ่มเล่น (เคยต่ำกว่า 10px แล้วโดนตัดครึ่งบน iPad)
     และเนื้อไม้ต้องต่อลงไปใต้แถบ (iPad บางรุ่นมีหน้าเว็บโผล่ใต้แถบล่าง เป็นแถบสีพื้น) — จำลองแถบลอยเหนือขอบ 30px */
  const bar = await page.evaluate(async () => { const t = document.getElementById("tpToggle").getBoundingClientRect(), pl = document.getElementById("play").getBoundingClientRect();
    const st = document.createElement("style"); st.textContent = "#tp{bottom:30px !important}"; document.head.appendChild(st);
    await new Promise((r) => setTimeout(r, 120)); const tb = document.getElementById("tp").getBoundingClientRect(); st.remove();
    return { dTop: Math.round(t.top - pl.top), cut: t.bottom > document.getElementById("tp").getBoundingClientRect().bottom + 1, skirtY: tb.bottom + 15 }; });
  await page.addStyleTag({ content: "#tp{bottom:30px !important}" }); await page.waitForTimeout(150);
  const skirt = await page.screenshot({ clip: { x: 400, y: Math.round(bar.skirtY), width: 1, height: 1 } });
  const rgb = await page.evaluate(async (b64) => { const im = new Image(); im.src = "data:image/png;base64," + b64; await im.decode();
    const c = document.createElement("canvas"); c.width = c.height = 1; const g = c.getContext("2d"); g.drawImage(im, 0, 0); return Array.from(g.getImageData(0, 0, 1, 1).data.slice(0, 3)); }, skirt.toString("base64"));
  const wood = await page.evaluate(() => { const c = document.createElement("canvas").getContext("2d"); c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--k-wood-b").trim();
    const h = c.fillStyle; return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); });
  await page.evaluate(() => { [...document.querySelectorAll("style")].filter((s) => /#tp\{bottom:30px/.test(s.textContent)).forEach((s) => s.remove()); });
  const woodOk = rgb.every((v, i) => Math.abs(v - wood[i]) <= 4);
  say(`แถบล่าง: ปุ่ม ▴ ต่างจากปุ่มเล่น ${bar.dTop}px · ถูกตัด ${bar.cut} · ใต้แถบเป็นไม้ ${woodOk} (${rgb.join(",")})`);
  if (Math.abs(bar.dTop) > 4 || bar.cut) fail.push(`${label}: ปุ่ม ▴ ไม่ตรงแถวปุ่มเล่นหรือถูกตัด (${bar.dTop}px)`);
  if (!woodOk) fail.push(`${label}: ใต้แถบล่างไม่ใช่เนื้อไม้ต่อกัน (${rgb.join(",")}) — แถบสีพื้นจะโผล่บน iPad`);
  /* iPad เพิ่งเปิดแอปจากหน้าโฮม: ระบบปิดขอบล่าง ~34px ด้วยแผ่นที่ย้อมสีตามพื้นของ body — พื้น html/body ต้องเป็นสีไม้ของแถบล่าง
     ส่วนพื้นที่ทำงานที่ตาเห็นต้องยังเป็นสีพื้นเดิม (main.wrap) */
  const pg = await page.evaluate(() => { const c = (e) => getComputedStyle(e).backgroundColor, cv = document.createElement("canvas").getContext("2d");
    const css = (v) => { cv.fillStyle = "#000"; cv.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(v).trim(); const h = cv.fillStyle;
      return "rgb(" + [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(", ") + ")"; };
    return { html: c(document.documentElement), body: c(document.body), main: c(document.querySelector("main.wrap")), wood: css("--k-wood-b"), bg: css("--bg") }; });
  say(`พื้นของหน้า (สีแผ่นขอบล่างของ iPad): html ${pg.html} · body ${pg.body} · ไม้ ${pg.wood} · พื้นที่ทำงาน ${pg.main} (สีพื้น ${pg.bg})`);
  if (pg.html !== pg.wood || pg.body !== pg.wood || pg.main !== pg.bg) fail.push(`${label}: พื้นของหน้าไม่ใช่สีไม้ หรือพื้นที่ทำงานเปลี่ยนสี (${pg.body} / ${pg.main})`);
  /* ใช้พื้นที่ให้คุ้ม: จำลอง iPad เปิดจากหน้าโฮม (แถบสถานะ 24 · ขีดโฮม 20) + เปิด "ล็อกจอ" (ผู้ใช้เปิดไว้)
     เคยเว้นซ้ำเหนือกริด 40px · เหนือแถบล่าง 18px · ใต้ปุ่มในแถบล่าง 28px */
  const sp = await page.evaluate(async () => {
    const st = document.createElement("style"); st.textContent = ":root{--sat:24px !important; --sab:20px !important}"; document.head.appendChild(st);
    const c = document.getElementById("lockScr"), was = c && c.checked; if (c && !was) c.click();
    await new Promise((r) => setTimeout(r, 500));
    const R = (q) => document.querySelector(q).getBoundingClientRect(), tb = R("#topbar"), gw = R("#gw"), sg = R("#stage"), tp = R("#tp"), pl = R("#play");
    const out = { locked: document.body.classList.contains("locked"), top: Math.round(gw.top - tb.bottom), above: Math.round(tp.top - sg.bottom), under: Math.round(tp.bottom - pl.bottom) };
    if (c && !was) c.click(); st.remove(); await new Promise((r) => setTimeout(r, 300)); return out; });
  say(`พื้นที่ (แถบสถานะ 24 · ขีดโฮม 20 · ล็อกจอ ${sp.locked}): เหนือกริด ${sp.top}px · เหนือแถบล่าง ${sp.above}px · ใต้ปุ่มแถบล่าง ${sp.under}px`);
  if (sp.top > 10 || sp.above > 8 || sp.under > 14) fail.push(`${label}: เว้นที่ว่างบน/ล่างมากเกินไป (เหนือกริด ${sp.top} · เหนือแถบ ${sp.above} · ใต้ปุ่ม ${sp.under})`);
  if (!mix.on || mix.to !== "31" || mix.back !== "42") fail.push(`${label}: แถบเสียงเพลง/กลองตอนย่อแถบล่างไม่ทำงาน`);
  await page.evaluate(() => { window.__hits = []; const K = window.KlongSounds, o = K.play.bind(K);
    K.play = (c, s, key, w, v) => { window.__hits.push(key); return o(c, s, key, w, v); }; });
  await page.evaluate(() => { document.querySelector('#scope button[data-v="bar"]').click(); document.getElementById("loop").checked = true;
    document.getElementById("play").click(); });
  await page.waitForTimeout(600);
  await page.touchscreen.tap(g.first + 220, g.kick);                    // กระเดื่องราวจังหวะ 3 ระหว่างเล่น
  await page.waitForTimeout(4300);
  const hits = await page.evaluate(() => window.__hits);
  await page.evaluate(() => document.getElementById("stopb").click());
  const kicks = hits.filter((k) => /kick/.test(k)).length, snares = hits.filter((k) => /snare/.test(k)).length;
  say(`วนห้องเดิม ~4.9 วิ: สแนร์ดัง ${snares} รอบ · กระเดื่องที่วางระหว่างเล่นดัง ${kicks} ครั้ง (ตอนแตะ 1 + ทุกรอบหลังจากนั้น)`);
  if (snares < 2) fail.push(`${label}: วนซ้ำห้องเดิมแล้วเสียงไม่วน (${snares})`);
  if (kicks < 3) fail.push(`${label}: โน้ตที่วางระหว่างเล่นไม่ดังในรอบถัดไป ต้องกดเล่นใหม่ (${kicks})`);
  say(`errors=${errs.join(" | ") || "ไม่มี"}`);
  if (errs.length) fail.push(`${label}: ${errs[0]}`);
  await browser.close();
}

/* ---- มือถือ Android + S Pen (Galaxy S26 Ultra: 384×784 แนวตั้ง · 784×352 แนวนอน ในแอปที่ติดตั้ง) ----
   ผู้ใช้เขียนโน้ตด้วย S Pen บนมือถือทั้งสองแนว ตรวจเฉพาะของมือถือ ที่เหลือชุด iPhone ตรวจแล้ว
   กริดต้องได้พื้นที่ (เดิมแนวตั้งเหลือ 40% แนวนอนไม่เห็นแถวกลอง) แผงเขียนโน้ตเกาะขอบจอไม่บังกริด
   ปากกา: ลอย = โชว์จุด · แตะ = วาง + สั่น · ปุ่มข้าง = ลบ · นิ้ว (เครื่องมือเลื่อน) ไม่วาง
   ปัดย้อนกลับของ Android ถอยทีละหน้า · แอปที่ติดตั้งบน Android ไม่มีช่องว่างแบบ iPad (บั๊กเดิม) */
async function phoneSuite(label, exe) {
  const UA = "Mozilla/5.0 (Linux; Android 16; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
  const browser = await chromium.launch({ executablePath: exe });
  const say = (t) => console.log(`[${label}] ${t}`);
  const errs = [];
  const open = async (vp, scr, init) => {
    const ctx = await browser.newContext({ viewport: vp, screen: scr, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/favicon/i.test(m.text())) errs.push(m.text()); });
    await page.goto(BASE, { waitUntil: "load" }); await page.waitForTimeout(500);
    return { ctx, page };
  };
  const box = (page, sel) => page.evaluate((q) => { const e = document.querySelector(q); if (!e) return null;
    const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);
  const notes = (page) => page.evaluate(() => +((/ตัวโน้ตรวม\s*(\d+)/.exec(document.getElementById("stats").textContent) || [])[1] || 0));

  /* แนวตั้ง */
  const P = await open({ width: 384, height: 784 }, { width: 384, height: 832 },
    () => { window.__buzz = 0; navigator.vibrate = () => { window.__buzz++; return true; }; });
  let page = P.page;
  /* ติดตั้งลงมือถือ: Chrome ต้องบอกว่าติดตั้งได้ (ไม่มีข้อผิดพลาด) · การ์ดบนหน้าแรกบอกวิธี (ยังไม่มีคำเชิญ)
     มีคำเชิญจากเบราว์เซอร์แล้วต้องเป็นปุ่มเดียว กดแล้วเรียกหน้าติดตั้งของเบราว์เซอร์ */
  const cdp0 = await P.ctx.newCDPSession(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  const inst = await cdp0.send("Page.getInstallabilityErrors");
  // บริบทของ Playwright เป็นแบบไม่ระบุตัวตน Chrome จึงตอบ in-incognito เสมอ — ไม่ใช่ปัญหาของเว็บ
  inst.installabilityErrors = inst.installabilityErrors.filter((e) => e.errorId !== "in-incognito");
  const man = JSON.parse((await cdp0.send("Page.getAppManifest")).data || "{}");
  const ic0 = await page.evaluate(() => { const c = document.getElementById("kInstall");
    return c && !c.hidden && document.getElementById("kInstBtn").hidden && /ติดตั้งแอป/.test(c.querySelector(".kinst-how").textContent); });
  const ic1 = await page.evaluate(async () => { window.__pr = 0; const e = new Event("beforeinstallprompt");
    e.prompt = () => { window.__pr++; }; e.userChoice = Promise.resolve({ outcome: "dismissed" }); dispatchEvent(e);
    const b = document.getElementById("kInstBtn"); const shown = !b.hidden; b.click(); await new Promise((r) => setTimeout(r, 50));
    return shown && window.__pr === 1; });
  say(`ติดตั้งลงมือถือ: ข้อผิดพลาดของ Chrome ${inst.installabilityErrors.length ? JSON.stringify(inst.installabilityErrors) : "ไม่มี"} · ชื่อแอป ${man.short_name} · ภาพหน้าติดตั้ง ${(man.screenshots || []).length} · การ์ดบอกวิธี ${ic0} · ปุ่มติดตั้ง ${ic1}`);
  if (inst.installabilityErrors.length) fail.push(`${label}: Chrome บอกว่าติดตั้งเป็นแอปไม่ได้ ${JSON.stringify(inst.installabilityErrors)}`);
  if (!ic0 || !ic1) fail.push(`${label}: การ์ดติดตั้งลงมือถือบนหน้าแรกไม่ทำงาน`);
  await page.click("#homeBlank"); await page.waitForTimeout(600);
  const pt = await page.evaluate(() => { const tb = document.getElementById("topbar");
    return { kp: document.documentElement.getAttribute("data-kphone"), h: tb.getBoundingClientRect().height, over: tb.scrollWidth - tb.clientWidth,
             min: document.getElementById("tp").classList.contains("min"), docked: document.getElementById("npal").classList.contains("docked") }; });
  const vis = async (q) => page.locator(q).isVisible().catch(() => false);
  const v0 = { tool: await vis("#tool"), undo: await vis("#undoBtn"), more: await vis("#kTbMore"), exp: await vis("#toExport") };
  await page.click("#kTbMore"); await page.waitForTimeout(200);
  const expOpen = await vis("#toExport");
  await page.click("#kTbMore"); await page.waitForTimeout(200);
  const st = await box(page, "#stage"), np = await box(page, "#npal"), tp = await box(page, "#tp");
  say(`แนวตั้ง: kphone=${pt.kp} · แถบบน ${Math.round(pt.h)}px ล้น ${pt.over}px · เครื่องมือ ${v0.tool} ย้อนแก้ ${v0.undo} ⋯ ${v0.more} · ส่งออกซ่อน ${!v0.exp} → กด ⋯ เห็น ${expOpen}`);
  say(`แนวตั้ง: แถบล่างเริ่มย่อ ${pt.min} · แผงเกาะขอบ ${pt.docked} · กริดสูง ${Math.round(st.h)}px (${Math.round(st.h / 784 * 100)}%) จบ ${Math.round(st.b)} · แผง ${Math.round(np.t)}–${Math.round(np.b)} · แถบล่าง ${Math.round(tp.t)}`);
  if (pt.kp !== "port") fail.push(`${label}: จอแนวตั้งไม่เข้าโหมดมือถือ`);
  if (pt.h > 70 || pt.over > 1) fail.push(`${label}: แถบบนไม่ได้เป็นแถวเดียว/ล้นจอ (${Math.round(pt.h)}px ล้น ${pt.over}px)`);
  if (!v0.tool || !v0.undo || !v0.more || v0.exp || !expOpen) fail.push(`${label}: แถบบนมือถือไม่ถูกต้อง (เครื่องมือ/ย้อนแก้/⋯/ส่งออกในแถวสอง)`);
  if (!pt.min || !pt.docked) fail.push(`${label}: มือถือไม่ได้เริ่มแบบย่อ หรือแผงเขียนโน้ตไม่เกาะขอบจอ`);
  if (st.b > np.t + 1 || Math.abs(np.b - tp.t) > 2) fail.push(`${label}: แผงเขียนโน้ตทับกริดหรือไม่ชิดแถบล่าง`);
  if (st.h < 784 * 0.55) fail.push(`${label}: กริดได้พื้นที่น้อยไป (${Math.round(st.h)}px)`);
  const hs = [];
  for (const c of ["dyn", "art", "line", "bar", "mix", "val"]) {
    await page.click(`#npal .np-tabs button[data-cat="${c}"]`); await page.waitForTimeout(120);
    hs.push(Math.round((await box(page, "#npal")).h));
  }
  await page.locator("#npal .np-vals button").nth(2).click(); await page.waitForTimeout(120);
  const valOk = await page.evaluate(() => document.querySelectorAll("#vals button")[2].getAttribute("aria-pressed") === "true");
  say(`แนวตั้ง: ความสูงแผงทุกหมวด ${hs.join("/")}px · เลือกค่าโน้ตจากแผง ${valOk}`);
  if (new Set(hs).size !== 1) fail.push(`${label}: แผงสูงไม่เท่ากันทุกหมวด กริดกระตุกตอนสลับหมวด (${hs.join("/")})`);
  if (!valOk) fail.push(`${label}: เลือกค่าโน้ตจากแผงที่เกาะขอบจอไม่ได้`);
  // แผงตั้งค่าอยู่ชั้นต่ำกว่าแผงเขียนโน้ต — เปิดตั้งค่าแล้วแผงเขียนโน้ตต้องหลบ ปิดแล้วกลับมา
  await showTopMore(page); await page.click("#moreBtn"); await page.waitForTimeout(300);
  const ins = await page.evaluate(() => ({ on: document.body.classList.contains("inspOn"), np: getComputedStyle(document.getElementById("npal")).display }));
  await page.click("#inspClose"); await page.waitForTimeout(300);
  const npBack = await page.locator("#npal").isVisible();
  say(`แนวตั้ง: เปิดตั้งค่า → แผงเขียนโน้ตหลบ ${ins.on && ins.np === "none"} · ปิดแล้วกลับมา ${npBack}`);
  if (!(ins.on && ins.np === "none" && npBack)) fail.push(`${label}: แผงเขียนโน้ตบังแผงตั้งค่า หรือไม่กลับมาหลังปิดตั้งค่า`);

  /* ปากกา */
  const s = await P.ctx.newCDPSession(page);
  const Y = await page.evaluate(() => { const r = [...document.querySelectorAll("#labels .r")][10].getBoundingClientRect(); return r.top + r.height / 2; });
  const X = 250, clip = { x: 140, y: Y - 14, width: 244, height: 28 };
  const shot = async () => (await page.screenshot({ clip })).toString("base64");
  const pen = (type, o = {}) => s.send("Input.dispatchMouseEvent", Object.assign({ type, x: X, y: Y, pointerType: "pen", button: "none", buttons: 0, clickCount: 0 }, o));
  const tapPen = async (btn, bs, x = X) => { await pen("mousePressed", { button: btn, buttons: bs, clickCount: 1, x }); await pen("mouseReleased", { button: btn, buttons: 0, clickCount: 1, x });
    await pen("mouseMoved", { x: 10, y: 10 }); await page.waitForTimeout(150); };
  const n0 = await notes(page), s0 = await shot();
  await pen("mouseMoved"); await page.waitForTimeout(150);
  const hover = (await shot()) !== s0;
  await tapPen("left", 1);
  const n1 = await notes(page), bz = await page.evaluate(() => window.__buzz);
  await tapPen("right", 2);
  const n2 = await notes(page);
  await tapPen("right", 2, X + 60);
  const n3 = await notes(page);
  await s.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: X, y: Y }] });
  await s.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await page.waitForTimeout(150);
  const n4 = await notes(page);
  say(`S Pen: ลอยโชว์จุด ${hover} · แตะวาง ${n0}→${n1} สั่น ${bz} ครั้ง · ปุ่มข้างลบ ${n1}→${n2} · ปุ่มข้างบนช่องว่าง ${n2}→${n3} · นิ้ว (เลื่อน) ${n3}→${n4}`);
  if (!hover) fail.push(`${label}: ปากกาลอยแล้วไม่โชว์จุดที่จะวาง`);
  if (n1 !== n0 + 1 || bz < 1) fail.push(`${label}: แตะปากกาแล้วไม่วางโน้ตหรือไม่สั่น`);
  if (n2 !== n1 - 1 || n3 !== n2) fail.push(`${label}: ปุ่มข้างปากกาไม่ลบ หรือไปวางโน้ตบนช่องว่าง`);
  if (n4 !== n3) fail.push(`${label}: นิ้วในเครื่องมือเลื่อนไปวางโน้ต`);

  /* ป้ายสถานะ + ปัดย้อนกลับ */
  await page.click('#npal .np-tabs button[data-cat="bar"]');
  await page.click('#npal .np-bar-b button[data-for="barCopy"]'); await page.waitForTimeout(150);
  const toast = await page.evaluate(() => { const e = document.getElementById("status"), r = e.getBoundingClientRect();
    return e.classList.contains("k-show") && getComputedStyle(e).visibility === "visible" && r.top >= 0 && r.bottom <= innerHeight && r.width > 40; });
  await showTopMore(page); await page.click("#toExport"); await page.waitForTimeout(600);
  const where = () => page.evaluate(() => /atexport/.test(document.body.className) ? "ส่งออก" : /athome/.test(document.body.className) ? "หน้าแรก" : "หน้าเขียน");
  const w0 = await where();
  await page.evaluate(() => history.back()); await page.waitForTimeout(500); const w1 = await where();
  await page.evaluate(() => history.back()); await page.waitForTimeout(500); const w2 = await where();
  say(`ป้ายสถานะ ${toast} · ปัดย้อนกลับ: ${w0} → ${w1} → ${w2}`);
  if (!toast) fail.push(`${label}: ผลการกดไม่ขึ้นเป็นป้ายบนจอมือถือ`);
  if (w0 !== "ส่งออก" || w1 !== "หน้าเขียน" || w2 !== "หน้าแรก") fail.push(`${label}: ปัดย้อนกลับไม่ถอยทีละหน้า (${w0} → ${w1} → ${w2})`);

  /* หมุนเป็นแนวนอน (หน้าเดิม) */
  await page.click("#homeBlank"); await page.waitForTimeout(400);
  await page.setViewportSize({ width: 784, height: 352 }); await page.waitForTimeout(600);
  const L = await page.evaluate(() => { const R = (q) => { const r = document.querySelector(q).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, h: r.height }; };
    const np = R("#npal"), tabs = [...document.querySelectorAll("#npal .np-tabs button")].map((b) => b.getBoundingClientRect());
    return { kp: document.documentElement.getAttribute("data-kphone"), st: R("#stage"), np, tb: R("#topbar"), tp: R("#tp"),
             tabsIn: tabs.length === 6 && tabs.every((r) => r.height > 30 && r.top >= np.t - 1 && r.bottom <= np.b + 1),
             play: (() => { const r = document.getElementById("play").getBoundingClientRect(); return r.width > 0 && r.bottom <= innerHeight; })(),
             over: document.documentElement.scrollWidth - innerWidth }; });
  say(`แนวนอน: kphone=${L.kp} · กริด ${Math.round(L.st.r)}×${Math.round(L.st.h)}px · แผงขวา ${Math.round(L.np.l)}–${Math.round(L.np.r)} สูง ${Math.round(L.np.h)} · หมวดครบในแผง ${L.tabsIn} · ปุ่มเล่นบนแถบบน ${L.tp.b <= L.tb.b + 1 && L.play}`);
  if (L.kp !== "land") fail.push(`${label}: หมุนเป็นแนวนอนแล้วไม่เข้าโหมดมือถือแนวนอน`);
  if (L.st.r > L.np.l + 1 || L.st.h < 260 || L.over > 1) fail.push(`${label}: แนวนอน กริดโดนแผงบังหรือได้พื้นที่น้อย (${Math.round(L.st.h)}px)`);
  if (!L.tabsIn) fail.push(`${label}: แนวนอน หมวดในแผงเขียนโน้ตไม่ครบ/หลุดแผง`);
  if (!(L.tp.b <= L.tb.b + 1 && L.play)) fail.push(`${label}: แนวนอน ปุ่มเล่นไม่ได้อยู่บนแถบบน`);
  await P.ctx.close();

  /* แอปที่ติดตั้ง: Android ต้องไม่มีช่องว่างแบบ iPad · iPad ยังได้ช่องว่างตามเดิม */
  const sa = () => { const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => /display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q); };
  const A = await open({ width: 384, height: 784 }, { width: 384, height: 832 }, sa);
  const ga = await A.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--kt-gap").trim());
  await A.ctx.close();
  const ictx = await browser.newContext({ viewport: { width: 834, height: 1160 }, screen: { width: 834, height: 1194 }, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
  await ictx.addInitScript(sa);
  const ip = await ictx.newPage(); await ip.goto(BASE, { waitUntil: "load" }); await ip.waitForTimeout(500);
  const gi = await ip.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--kt-gap").trim());
  await ictx.close();
  say(`แอปที่ติดตั้ง: ช่องว่างล่าง Android ${ga} · iPad ${gi}`);
  if (ga !== "0px") fail.push(`${label}: แอปที่ติดตั้งบน Android ได้ช่องว่างแบบ iPad (${ga}) แถบล่างจะหลุดจอ`);
  if (gi !== "34px") fail.push(`${label}: iPad ที่เปิดจากหน้าโฮมไม่ได้ช่องว่างล่างแล้ว (${gi})`);

  say(`errors=${errs.join(" | ") || "ไม่มี"}`);
  if (errs.length) fail.push(`${label}: ${errs[0]}`);
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
    await editSuite("iPad-แก้ระหว่างเล่น", exe);
    await phoneSuite("Android", exe);
  } finally { server.close(); }
  console.log("\n================ RESULT ================");
  if (fail.length) { console.log("ไม่ผ่าน:\n - " + fail.join("\n - ")); process.exit(1); }
  console.log("ผ่านทั้งหมด");
})();
