#!/usr/bin/env node
/* ตรวจภาษาอังกฤษของครูต้า (tools/lesson-layer/05-i18n.js + lesson/i18n/en.json)
 *
 *   npm i playwright && node tools/test-i18n.js
 *
 * ค่าเริ่มต้นเป็นไทย · เลือก English จากหน้าตั้งค่าแล้วเปลี่ยนทันที · ทุกหน้าหลักแทบไม่เหลือข้อความไทย
 * (นอกจากชื่อนักเรียน/ข้อมูลที่ครูพิมพ์) · ของที่ส่งผู้ปกครองยังเป็นไทย · กลับเป็นไทยได้
 * ออก 0 = ผ่าน, 1 = ไม่ผ่าน
 */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium, devices } = require("playwright");

const ROOT = path.resolve(__dirname, ".."), PREFIX = "/T/";
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".json": "application/json", ".woff2": "font/woff2" };
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
  let rel = decodeURIComponent(req.url.split("?")[0]);
  if (!rel.startsWith(PREFIX)) { res.writeHead(404); return res.end(); }
  rel = rel.slice(PREFIX.length); if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const f = path.join(ROOT, rel);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
const NAMES = ["harvey", "มายด์", "เจอาร์", "ณิชา"];

(async () => {
  await new Promise((r) => server.listen(0, r));
  const URL_ = "http://localhost:" + server.address().port + PREFIX + "lesson/";
  const dict = JSON.parse(fs.readFileSync(path.join(ROOT, "lesson", "i18n", "en.json"), "utf8"));
  ok(Object.keys(dict).length > 2500 && Object.values(dict).every((v) => typeof v === "string"), "พจนานุกรม " + Object.keys(dict).length + " ข้อความ อ่านได้");

  const browser = await chromium.launch({ executablePath: chromiumPath() });
  const ctx = await browser.newContext({ ...devices["Galaxy S9+"], serviceWorkers: "block" });
  const p = await ctx.newPage(); const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(URL_);
  await p.evaluate(() => { lsSet("td_pw", hashPw("1234")); document.getElementById("pw-input").value = "1234"; doLogin(); });
  await p.waitForFunction(() => document.getElementById("app").style.display === "block");
  await p.evaluate((names) => {
    const t = todayStr(), att = ["present", "planned", "lateCancel", "sick"];
    for (let i = 0; i < 16; i++) S.lessons.push({ id: 61000 + i, date: addDays(t, -Math.floor(i / 4)), time: (9 + (i % 4) * 2) + ":00", kind: i % 2 ? "private" : "school", duration: 1, rate: 300, heads: 1,
      attendance: att[i % 4], student: names[i % 4], topic: "Groove", notes: "ดีมาก", scores: [{ label: "60 BPM", score: 4, remark: "" }], practiceItems: [], updatedAt: nowISO() });
    save(); DAYV.date = t; setTab("today"); renderAll();
  }, NAMES);
  ok(await p.evaluate(() => window.__i18n === "th" && /คาบวันนี้/.test(document.body.innerText)), "ค่าเริ่มต้นเป็นภาษาไทยเหมือนเดิม");

  // เลือก English จากหน้าตั้งค่า: เปลี่ยนทันที ไม่ต้องเข้าแอปใหม่
  await p.evaluate(() => openMenu());
  ok(await p.evaluate(() => /ภาษา · Language/.test((document.getElementById("lang-row") || {}).textContent || "")), "หน้าตั้งค่ามีแถว 🌐 ภาษา · Language");
  await p.evaluate(() => { document.getElementById("lang-row").click(); });
  await p.click('[data-lang="en"]');
  await p.waitForFunction(() => /lessons today/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {});
  ok(await p.evaluate(() => window.__i18n === "en" && document.getElementById("app").style.display === "block" && /lessons today/.test(document.body.innerText)),
    "เลือก English: หน้าจอเปลี่ยนทันที ยังอยู่ในแอป (ไม่ต้องปลดล็อกใหม่)");

  const THAI = /[ก-ฺเ-๛]/;
  const leftover = () => p.evaluate((names) => {
    const out = [], tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
    while ((n = tw.nextNode())) {
      const v = n.nodeValue.trim(), el = n.parentElement;
      if (!v || !/[ก-ฺเ-๛]/.test(v) || !el || el.closest("[data-noi18n], .textpreview, script, style")) continue;
      const r = el.getBoundingClientRect(); if (!r.width && !r.height) continue;
      if (v.length <= 2 || names.some((x) => v === x) || /^(ดีมาก|น้องเจมส์|น้องมิ้น)$/.test(v)) continue;
      out.push(v);
    }
    return out;
  }, NAMES);
  const screens = [
    ["Today", () => { closeModal(); setTab("today"); }],
    ["Students", () => { setTab("students"); setSub("students", "people"); }],
    ["Week", () => setSub("students", "week")],
    ["Income", () => setTab("income")],
    ["Overview", () => setTab("overview")],
    ["Settings", () => openMenu()],
    ["Add lesson", () => { closeModal(); openAdd(); }],
    ["Student profile", () => { closeModal(); openStudentProfile("harvey"); }],
    ["Notifications", () => { closeModal(); openPush(); }],
    ["Backup", () => { closeModal(); openBackup(); }]
  ];
  let worst = [];
  for (const [name, fn] of screens) {
    await p.evaluate(fn); await p.waitForTimeout(300);
    const left = await leftover();
    if (left.length > 2) worst.push(name + ": " + left.slice(0, 3).join(" | "));
  }
  ok(!worst.length, "หน้าหลัก 10 หน้า: เหลือข้อความไทยไม่เกิน 2 ชิ้นต่อหน้า (ไม่นับชื่อ/ข้อมูลที่ครูพิมพ์)" + (worst.length ? " — " + worst.join(" ; ") : ""));

  const misc = await p.evaluate(async () => {
    const tick = () => new Promise((r) => setTimeout(r, 60));
    closeModal(); setTab("students"); setSub("students", "people"); await tick();
    const nav = Array.from(document.querySelectorAll("nav button, .bnav button, [class*=tabbar] button")).map((b) => b.textContent.trim()).join("|");
    const seg = Array.from(document.querySelectorAll(".segbtn")).map((b) => b.textContent.trim()).join("|");
    const money = /฿ \d/.test(document.body.innerText);
    const ini = Array.from(document.querySelectorAll("button.acard div")).some((d) => d.textContent.trim() === "มา");
    setTab("today"); await tick();
    const ring = Array.from(document.querySelectorAll("svg text")).map((t) => t.textContent).join("|");
    return { nav, seg, money, ini, ring, sing: /\b1 lessons\b|\b1 people\b/.test(document.body.innerText) };
  });
  ok(/Week/.test(misc.seg) && /Log/.test(misc.seg) && !/Save/.test(misc.seg), "แท็บย่อยใช้คำตามความหมาย (" + misc.seg + ")");
  ok(!misc.money && misc.ini && !misc.sing, "฿ ไม่ถูกแยกจากตัวเลข · อักษรย่อชื่อในวงกลมไม่ถูกแปล · ไม่มี “1 lessons”");

  // ของที่ส่งผู้ปกครองยังเป็นไทย
  const share = await p.evaluate(async () => {
    openShare(61000); await new Promise((r) => setTimeout(r, 400));
    const pv = document.querySelector(".textpreview"); const t = pv ? pv.textContent : "";
    closeModal(); return t;
  });
  ok(THAI.test(share), "ตัวอย่างข้อความถึงผู้ปกครองยังเป็นภาษาไทย (ตรงกับที่ส่งจริง)");
  ok(await p.evaluate(() => window.__tr("ใช้ {ชื่อ} แทนชื่อนักเรียน และ {ครู} แทนชื่อครู").indexOf("{ครู}") >= 0), "คำในแม่แบบ {ครู} {ชื่อ} ไม่ถูกแปล");

  // รีเซ็ตแอป: พิมพ์ Delete all ได้
  const rst = await p.evaluate(async () => {
    RST.step = 3; showFactoryReset(); await new Promise((r) => setTimeout(r, 100));
    const i = document.getElementById("rst-word"); if (!i) return "no-input";
    i.value = "Delete all"; i.dispatchEvent(new Event("input", { bubbles: true }));
    const b = document.getElementById("rst-go"); const res = b && !b.disabled && RST.typed === "ลบทั้งหมด";
    closeModal(); return res;
  });
  ok(rst === true, "รีเซ็ตแอปภาษาอังกฤษ: พิมพ์ “Delete all” ยืนยันได้");

  // เปิดแอปใหม่ยังเป็นอังกฤษ · หน้าล็อกก็อังกฤษ
  await p.reload(); await p.waitForTimeout(1200);
  ok(await p.evaluate(() => window.__i18n === "en" && !/[ก-ฺเ-๛]/.test(document.getElementById("login-wrap").innerText.replace(/ภาษา/g, ""))), "เปิดแอปใหม่: หน้าล็อกเป็นภาษาอังกฤษ");
  await p.evaluate(() => { document.getElementById("pw-input").value = "1234"; doLogin(); });
  await p.waitForFunction(() => document.getElementById("app").style.display === "block");
  // กลับเป็นไทย
  await p.evaluate(() => openLang());
  await Promise.all([p.waitForNavigation(), p.click('[data-lang="th"]')]);
  await p.waitForTimeout(800);
  ok(await p.evaluate(() => window.__i18n === "th" && /รหัสผ่าน/.test(document.getElementById("login-wrap").innerText)), "เลือกไทย: กลับเป็นภาษาไทยทั้งหมด");
  ok(!errs.length, "ไม่มี error ใน console" + (errs.length ? ": " + errs.join(" | ") : ""));

  await browser.close(); server.close();
  console.log(fail.length ? "\n✗ ไม่ผ่าน " + fail.length + " ข้อ" : "\n✓ ผ่านทั้งหมด");
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
