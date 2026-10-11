#!/usr/bin/env node
/* วัดความเร็วของครูต้า (lesson/index.html) ด้วยข้อมูลขนาดใหญ่ — ใช้เทียบก่อน/หลังปรับแต่ง
 *
 *   npm i playwright && node tools/perf-lesson.js [--cpu 4] [--runs 5] [--json out.json]
 *
 * ข้อมูลจำลอง: นักเรียน 80 คน (มีรูป 40 คน) · คาบสอน 3 ปี (~3,600 คาบ) · ตารางประจำ 40 ช่อง
 * · 3 สถานที่ · 12 คอร์ส · งานสำคัญ 3 งาน (คนละ 30 คน) · CPU ช้าลง 4 เท่า (ใกล้มือถือทั่วไป)
 * แต่ละรายการวัดหลายรอบแล้วใช้ค่ากลาง (median) หน่วยเป็นมิลลิวินาที
 */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CPU = Number(arg("--cpu", 4)), RUNS = Number(arg("--runs", 5)), OUT = arg("--json", "");
const ROOT = path.resolve(__dirname, ".."), PREFIX = "/T/";
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".json": "application/json", ".woff2": "font/woff2" };
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

/* ── ข้อมูลจำลอง (สุ่มแบบกำหนดเมล็ด ได้ชุดเดิมทุกครั้ง) ── */
function dataset() {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const syl = ["มา", "ยด์", "ก้า", "ว", "ออส", "การ์", "ธา", "วิน", "ไข่", "หลิน", "นิว", "ตัน", "ภีม", "ปั้น", "ข้าว", "หอม", "ต้น", "กล้า"];
  const students = [], names = {};
  while (students.length < 80) {
    const n = pick(syl) + pick(syl);
    if (names[n]) continue; names[n] = 1;
    students.push({ key: n, name: n, code: "S" + pad(students.length + 1).padStart(3, "0"), aliases: [], age: 8 + Math.floor(rnd() * 8), ageAt: "2026-01-01", startDate: "2023-10-01", note: "" });
  }
  const places = [
    { id: 1001, name: "PlaySound Chonburi", rate: 270, payMode: "session", active: true, note: "", dur: 50 / 60 },
    { id: 1002, name: "Sangtian School", rate: 350, payMode: "hour", active: true, note: "" },
    { id: 1003, name: "Music Hub", rate: 300, payMode: "session", active: true, note: "" }
  ];
  const schedule = [];
  for (let i = 0; i < 40; i++) {
    const s = students[i];
    schedule.push({ id: 2000 + i, student: s.key, day: (i % 6) + 1, time: pad(9 + (i % 9)) + ":00", kind: i % 5 === 0 ? "private" : "school", placeId: i % 5 === 0 ? null : places[i % 3].id, note: "" });
  }
  const courses = [];
  for (let i = 0; i < 12; i++) courses.push({ id: 3000 + i, student: students[i * 5].key, name: "คอร์ส " + (8 + i % 3 * 2) + " ครั้ง", sessions: 8 + i % 3 * 2, price: 6000, hoursPer: 1, startDate: "2026-06-01", active: true, note: "" });
  const lessons = []; let id = 100000;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const topics = ["Groove 4/4", "ฟิลล์อิน 16th", "Paradiddle", "เพลง Seven Nation Army", "อ่านโน้ต", "Double stroke", "Shuffle", "Ghost note"];
  for (let back = 3 * 365; back >= -21; back--) {
    const d = new Date(today); d.setDate(d.getDate() - back);
    const wd = d.getDay(); if (wd === 0) continue;
    const n = wd === 6 ? 6 : 3;
    for (let j = 0; j < n; j++) {
      const s = students[Math.floor(rnd() * 80)], school = rnd() < 0.8, pl = places[Math.floor(rnd() * 3)];
      const future = back < 0;
      const att = future ? "planned" : (rnd() < 0.9 ? "present" : pick(["sick", "lateCancel"]));
      lessons.push({ id: id++, date: iso(d), time: pad(9 + j * 1 + (j > 3 ? 1 : 0)) + ":00", kind: school ? "school" : "private", duration: school ? 50 / 60 : 1,
        rate: school ? pl.rate : 0, payMode: school ? pl.payMode : "hour", heads: 1, courseId: null, placeId: school ? pl.id : null, student: s.key,
        topic: pick(topics), notes: rnd() < 0.5 ? "ตั้งใจดีมาก ฝึกเพิ่มเรื่องจังหวะ" : "", videoLink: "", nextLesson: rnd() < 0.3 ? pick(topics) : "", media: null,
        scores: rnd() < 0.4 ? [{ label: "80 BPM", score: 4, remark: "" }] : [], practiceItems: rnd() < 0.3 ? [{ pid: "p" + id, text: "ซ้อม 10 นาที", done: rnd() < 0.5 }] : [],
        attendance: att, subNote: "", subLinks: [], updatedAt: d.toISOString() });
    }
  }
  // รูปนักเรียน 40 คน (~30 KB ต่อรูป เหมือนรูปที่ย่อแล้วจริง)
  const photos = {};
  for (let i = 0; i < 40; i++) photos[students[i].key] = "data:image/jpeg;base64," + Buffer.alloc(22000, i).toString("base64");
  const events = [0, 1, 2].map((k) => ({ id: 4000 + k, title: ["คอนเสิร์ตปลายปี", "สอบเกรด", "แข่งวงโยธวาทิต"][k], date: iso(new Date(today.getTime() + [49, 120, 300][k] * 864e5)),
    time: "09:00", place: "", note: "", emoji: "🎤", students: students.slice(k * 10, k * 10 + 30).map((s) => s.key), createdAt: new Date(today.getTime() - 20 * 864e5).toISOString() }));
  return { students, places, schedule, courses, lessons, photos, events };
}

const median = (a) => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };

(async () => {
  await new Promise((r) => server.listen(0, r));
  const URL_ = "http://localhost:" + server.address().port + PREFIX + "lesson/";
  const browser = await chromium.launch({ executablePath: chromiumPath() });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 880 }, deviceScaleFactor: 2, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const cdp = await ctx.newCDPSession(p);
  const D = dataset();
  // ใส่ข้อมูลลงเครื่อง แล้วล็อกอินครั้งแรก (อัปเกรดรหัสเป็น PBKDF2 ไปเลย ไม่ให้ปนกับการวัด)
  await p.goto(URL_);
  await p.evaluate((D) => {
    localStorage.setItem("td_lessons", JSON.stringify(D.lessons));
    localStorage.setItem("td_students", JSON.stringify(D.students));
    localStorage.setItem("td_places", JSON.stringify(D.places));
    localStorage.setItem("td_schedule", JSON.stringify(D.schedule));
    localStorage.setItem("td_courses", JSON.stringify(D.courses));
    localStorage.setItem("td_photos", JSON.stringify(D.photos));
    const st = JSON.parse(localStorage.getItem("td_settings") || "{}"); st.events = D.events; st.teacherName = "ครูต้า";
    localStorage.setItem("td_settings", JSON.stringify(st));
    lsSet("td_pw", hashPw("1234"));
  }, D);
  await p.reload();
  await p.evaluate(() => startApp());              // ข้ามหน้าล็อก (PBKDF2 ตั้งใจให้ช้าเพื่อความปลอดภัย ไม่นับ)
  await p.waitForFunction(() => document.getElementById("app").style.display === "block", null, { timeout: 60000 });
  await p.waitForTimeout(1500);

  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  const R = {};
  const add = (k, v) => { (R[k] = R[k] || []).push(v); };

  for (let run = 0; run < RUNS; run++) {
    // ── เปิดแอป: โหลดหน้า → พร้อมใส่รหัส · เข้าแอป (ไม่นับ PBKDF2) → หน้าวันนี้ขึ้น
    await p.reload({ waitUntil: "load" });
    const nav = await p.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd }; });
    add("โหลดหน้า → DOMContentLoaded", nav.dcl);
    add("โหลดหน้า → load", nav.load);
    const start = await p.evaluate(() => new Promise((res) => {
      const t0 = performance.now(); startApp();
      const wait = () => document.querySelector("#view-today .datenav") ? res(performance.now() - t0) : setTimeout(wait, 5);
      wait();
    }));
    add("เข้าแอป (startApp) → หน้าวันนี้ขึ้น", start);
    await p.waitForTimeout(2500);                 // เหมือนครูดูหน้าวันนี้สักครู่ก่อนไปหน้าอื่น

    const m = await p.evaluate(async () => {
      const out = {}, tick = () => new Promise((r) => setTimeout(r, 30));
      const time = async (k, fn) => { const t0 = performance.now(); fn(); out[k] = performance.now() - t0; await tick(); };
      await time("แท็บวันนี้ (renderAll)", () => { setTab("today"); });
      await time("แท็บนักเรียน › รายคน", () => { setTab("students"); setSub("students", "people"); });
      await time("แท็บนักเรียน › บันทึก", () => { setSub("students", "log"); });
      await time("แท็บนักเรียน › สัปดาห์", () => { setSub("students", "week"); });
      await time("แท็บรายได้", () => { setTab("money"); });
      await time("แท็บภาพรวม (รวมงานสำคัญ)", () => { setTab("overview"); });
      await time("บันทึก (save) 1 ครั้ง", () => { S.lessons[0].notes = "x" + Math.random(); save(); });
      await time("ติ๊กการบ้าน (save + วาดใหม่)", () => { const l = S.lessons.find((x) => x.practiceItems.length); l.practiceItems[0].done = !l.practiceItems[0].done; save(); renderAll(); });
      setTab("today");
      await time("เปิดหน้านักเรียน", () => { openStudent(S.students[3].key); });
      closeModal(); await tick();
      await time("เปิดฟอร์มเพิ่มคาบ", () => { openAdd(); });
      await time("พิมพ์ชื่อนักเรียนในฟอร์ม", () => { onStudentInput(S.students[5].key); });
      LESSON_OPEN = false; closeModal(); await tick();
      await time("เปิดหน้างานสำคัญ (30 คน)", () => { openEvent(S.settings.events[0].id); });
      closeModal(); await tick();
      // วางตารางจากไลน์ 24 คน
      openPasteImport(); await tick();
      const names = S.students.slice(0, 24).map((s, i) => (8 + (i % 10)) + "." + (i % 2 ? "30" : "00") + " " + s.name).join("\n");
      PI.text = "วันเสาร์ 17/10/2569\n" + names;
      await time("วางตารางจากไลน์ (24 คน) อ่าน+แสดงตัวอย่าง", () => { reparseImport(); renderImportPreview(); });
      await time("เลือกนักเรียนในตัวอย่าง 1 ครั้ง", () => { PI.pick[0] = PI.pick[0]; PI.pickTouched[0] = true; renderImportPreview(); });
      closeModal(); await tick();
      await time("เปิดหน้าตั้งค่า", () => { openMenu(); });
      closeModal(); await tick();
      return out;
    });
    Object.keys(m).forEach((k) => add(k, m[k]));

  }

  // ── ภาษาอังกฤษ (ตัวแปลบนหน้าจอ) ──
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await p.evaluate(() => { localStorage.setItem("td_lang", "en"); });
  await p.reload({ waitUntil: "load" });
  await p.evaluate(() => startApp());
  await p.waitForFunction(() => window.__i18n === "en", null, { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(1500);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  for (let run = 0; run < RUNS; run++) {
    const m = await p.evaluate(async () => {
      const out = {}, settle = () => new Promise((r) => setTimeout(r, 0)).then(() => new Promise((r) => requestAnimationFrame(() => r())));
      const time = async (k, fn) => { const t0 = performance.now(); fn(); await Promise.resolve(); await settle(); out[k] = performance.now() - t0; };
      await time("EN: แท็บวันนี้ (วาด+แปล)", () => setTab("today"));
      await time("EN: แท็บภาพรวม (วาด+แปล)", () => setTab("overview"));
      await time("EN: แท็บนักเรียน › บันทึก (วาด+แปล)", () => { setTab("students"); setSub("students", "log"); });
      await time("EN: เปิดหน้าตั้งค่า (วาด+แปล)", () => openMenu());
      closeModal();
      return out;
    });
    Object.keys(m).forEach((k) => add(k, m[k]));
  }
  await p.evaluate(() => { localStorage.removeItem("td_lang"); });

  // ── โหมดกลางคืน (ชั้นแปลงสีทำงานทุกครั้งที่วาด) ──
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await p.evaluate(() => { localStorage.setItem("td_theme", "dark"); });
  await p.reload({ waitUntil: "load" });
  await p.evaluate(() => startApp());
  await p.waitForTimeout(2500);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  for (let run = 0; run < RUNS; run++) {
    const m = await p.evaluate(async () => {
      const out = {}, settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const time = async (k, fn) => { const t0 = performance.now(); fn(); await settle(); out[k] = performance.now() - t0; };
      await time("มืด: แท็บวันนี้ (วาด+แปลงสี)", () => setTab("today"));
      await time("มืด: แท็บนักเรียน › รายคน (วาด+แปลงสี)", () => { setTab("students"); setSub("students", "people"); });
      await time("มืด: แท็บนักเรียน › บันทึก (วาด+แปลงสี)", () => setSub("students", "log"));
      await time("มืด: แท็บภาพรวม (วาด+แปลงสี)", () => setTab("overview"));
      await time("มืด: เปิดหน้าตั้งค่า (วาด+แปลงสี)", () => openMenu());
      closeModal();
      return out;
    });
    Object.keys(m).forEach((k) => add(k, m[k]));
  }
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await p.evaluate(() => { localStorage.removeItem("td_theme"); });

  // ── ขนาดข้อมูลในเครื่อง ──
  const sizes = await p.evaluate(() => {
    const o = {}; ["td_lessons", "td_photos", "td_settings", "td_students"].forEach((k) => { o[k] = (localStorage.getItem(k) || "").length; }); return o;
  });

  await browser.close(); server.close();
  const rows = Object.keys(R).map((k) => [k, median(R[k])]);
  const w = Math.max(...rows.map((r) => r[0].length));
  console.log("CPU ช้าลง " + CPU + " เท่า · " + RUNS + " รอบ · ค่ากลาง (ms) · คาบ " + D.lessons.length + " · นักเรียน " + D.students.length);
  rows.forEach((r) => console.log("  " + r[0].padEnd(w) + "  " + r[1].toFixed(1).padStart(8)));
  console.log("  ขนาดในเครื่อง: " + Object.keys(sizes).map((k) => k + " " + Math.round(sizes[k] / 1024) + " KB").join(" · "));
  if (errs.length) console.log("  ! error: " + errs.slice(0, 5).join(" | "));
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ cpu: CPU, runs: RUNS, rows: Object.fromEntries(rows), sizes }, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
