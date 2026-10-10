#!/usr/bin/env node
/* ตรวจงานสำคัญ (นับถอยหลัง) — tools/lesson-layer/65-events.js
 *
 *   npm i playwright && node tools/test-events.js
 *
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

(async () => {
  await new Promise((r) => server.listen(0, r));
  const URL_ = "http://localhost:" + server.address().port + PREFIX + "lesson/";
  const browser = await chromium.launch({ executablePath: chromiumPath() });
  const ctx = await browser.newContext({ ...devices["Galaxy S9+"], serviceWorkers: "block" });
  const p = await ctx.newPage(); const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.goto(URL_);
  await p.evaluate(() => { lsSet("td_pw", hashPw("1234")); document.getElementById("pw-input").value = "1234"; doLogin(); });
  await p.waitForFunction(() => document.getElementById("app").style.display === "block");
  ok(await p.evaluate(() => window.__events === "on"), "ชั้น 65-events ทำงาน");

  // นักเรียน 4 คน: เอ (ตารางประจำทุกสัปดาห์) · บี (คาบที่ลงไว้) · ซี (ไม่มีตาราง แต่มาเรียนสม่ำเสมอ) · ดี (ไม่มีอะไร)
  await p.evaluate(() => {
    const t = todayStr(), wd = new Date(addDays(t, 1) + "T00:00:00").getDay();
    ["เอ", "บี", "ซี", "ดี"].forEach((n, i) => S.students.push({ key: n, name: n, code: "E" + i, aliases: [], age: null, ageAt: "", startDate: t, note: "" }));
    S.schedule.push({ id: 81001, student: "เอ", day: wd, time: "10:00", kind: "school", placeId: null, note: "" });
    const L = (id, who, date, time, att) => ({ id, date, time, kind: "school", duration: 1, rate: 0, payMode: "session", heads: 1, courseId: null, placeId: null,
      student: who, topic: "x", notes: "", videoLink: "", nextLesson: "", media: null, scores: [], practiceItems: [], attendance: att, updatedAt: nowISO() });
    S.lessons.push(L(82001, "บี", addDays(t, 3), "16:00", "planned"), L(82002, "บี", addDays(t, 10), "16:00", "planned"),
      L(82003, "บี", addDays(t, 28), "10:00", "planned"), L(82004, "บี", addDays(t, 28), "19:00", "planned"), L(82005, "บี", addDays(t, 5), "16:00", "sick"));
    for (let i = 1; i <= 8; i++) S.lessons.push(L(83000 + i, "ซี", addDays(t, -7 * i + 1), "15:00", "present"));
    // วันหยุด 1 วันทับคาบของเอ (สัปดาห์ที่ 2)
    S.settings.closures = (S.settings.closures || []).concat([{ id: 84001, from: addDays(t, 8), to: addDays(t, 8), scope: "all", title: "หยุด" }]);
    migrate(); save(); setTab("overview"); renderAll();
  });
  ok(await p.evaluate(() => !!document.querySelector("#ev-sec [data-ev-new]")), "แท็บภาพรวม: มีหัวข้อ 🎯 งานสำคัญ และปุ่มเพิ่ม");

  // ── สร้างงานจากฟอร์ม แล้วเลือกนักเรียนแบบติ๊ก ──
  const made = await p.evaluate(async () => {
    const tick = (ms) => new Promise((r) => setTimeout(r, ms || 40));
    document.querySelector("#ev-sec [data-ev-new]").click(); await tick();
    document.getElementById("evf-title").value = "คอนเสิร์ตปลายปี";
    document.getElementById("evf-date").value = addDays(todayStr(), 28);
    document.getElementById("evf-time").value = "18:00";
    document.getElementById("evf-place").value = "หอประชุม";
    document.querySelector('[data-evf-emo="🥁"]').click();
    document.querySelector("[data-evf-save]").click(); await tick();
    const picker = !!document.getElementById("ev-picklist");
    const box = (k) => document.querySelector('[data-ev-tick="' + k + '"]');
    ["เอ", "บี", "ซี", "ดี"].forEach((k) => { const b = box(k); b.click(); });
    await tick();
    const ev = S.settings.events[0];
    const done = document.getElementById("ev-done").textContent;
    // ค้นชื่อ + เอาออกทั้งหมดที่เห็น
    const q = document.getElementById("ev-q"); q.value = "ดี"; q.dispatchEvent(new Event("input")); await tick();
    const shown = document.querySelectorAll("#ev-picklist [data-ev-tick]").length;
    document.querySelector('[data-ev-all="0"]').click(); await tick();
    const afterClear = ev.students.slice();
    document.querySelector('[data-ev-all="1"]').click(); await tick();
    q.value = ""; q.dispatchEvent(new Event("input")); await tick();
    document.querySelector('[data-ev-f="on"]').click(); await tick();
    const onlyChosen = document.querySelectorAll("#ev-picklist [data-ev-tick]").length;
    return { picker, title: ev.title, emoji: ev.emoji, place: ev.place, students: ev.students.slice(), done, shown, afterClear, onlyChosen,
      saved: JSON.parse(lsGet("td_settings")).events.length, sync: (syRecords()["settings~main"] || { data: {} }).data.events.length };
  });
  ok(made.picker && made.title === "คอนเสิร์ตปลายปี" && made.emoji === "🥁" && made.place === "หอประชุม", "สร้างงาน: ชื่อ ไอคอน สถานที่ แล้วไปหน้าเลือกนักเรียนต่อ");
  ok(made.students.join() === "เอ,บี,ซี,ดี" && /4/.test(made.done), "ติ๊กนักเรียน 4 คน บันทึกทันที (" + made.done + ")");
  ok(made.shown === 1 && made.afterClear.join() === "เอ,บี,ซี" && made.onlyChosen === 4, "ค้นชื่อ · เอาออก/เลือกทั้งหมดที่เห็น · กรอง “ที่เลือกแล้ว”");
  ok(made.saved === 1 && made.sync === 1, "เก็บใน S.settings.events (บันทึกในเครื่อง และอยู่ในชุดที่ซิงค์)");

  // ── นับครั้งที่เหลือ ──
  const c = await p.evaluate(() => {
    const out = {}; __eventCounts(S.settings.events[0].id).forEach((x) => { out[x.key] = x; }); return out;
  });
  ok(c["เอ"].n === 3, "เอ (ตารางประจำทุกสัปดาห์ 4 ครั้ง หยุด 1 วัน) → เรียนอีก 3 ครั้ง (ได้ " + c["เอ"].n + ")");
  ok(c["บี"].n === 3, "บี (คาบที่ลงไว้ 2 + วันงานก่อน 18:00 อีก 1 · ไม่นับลาป่วย/หลังเวลางาน) → 3 ครั้ง (ได้ " + c["บี"].n + ")");
  ok(c["ซี"].n === 0 && c["ซี"].est === 4, "ซี (ไม่มีตาราง มาเรียนสัปดาห์ละครั้ง) → ประมาณ ≈4 ครั้ง (ได้ " + c["ซี"].est + ")");
  ok(c["ดี"].n === 0 && c["ดี"].est == null, "ดี (ไม่มีตาราง/ประวัติ) → ไม่มีคาบก่อนวันงาน");

  // ── หน้างาน + ถอนออก + เลิกทำ ──
  const view = await p.evaluate(async () => {
    const tick = (ms) => new Promise((r) => setTimeout(r, ms || 40));
    closeModal(); setTab("overview"); renderAll(); await tick();
    const card = document.querySelector("#ev-sec .ev-card");
    const cardTxt = card.textContent;
    card.click(); await tick();
    const box = document.getElementById("modal-box");
    const order = Array.from(box.querySelectorAll(".ev-row [data-noi18n]")).map((e) => e.textContent);
    const txt = box.textContent;
    box.querySelector('[data-ev-out="บี"]').click(); await tick();
    const after = S.settings.events[0].students.slice();
    const undo = Array.from(document.querySelectorAll("#toast button, .toast button, button")).find((b) => b.textContent.trim() === "เลิกทำ");
    if (undo) undo.click(); await tick();
    return { cardTxt, order, txt, after, back: S.settings.events[0].students.slice(), undo: !!undo };
  });
  ok(/สัปดาห์/.test(view.cardTxt) && /นักเรียน 4 คน/.test(view.cardTxt) && /น้อยสุด/.test(view.cardTxt), "การ์ดภาพรวม: นับถอยหลัง + จำนวนนักเรียน + คนที่เหลือน้อยสุด");
  ok(view.order[0] === "ดี" && /เรียนอีก 3 ครั้ง/.test(view.txt) && /ครั้งสุดท้าย/.test(view.txt) && /ตาราง/.test(view.txt), "หน้างาน: เรียงคนที่เหลือน้อยสุดก่อน บอกครั้งสุดท้ายและตารางเรียน (" + view.order.join(",") + ")");
  ok(!view.after.includes("บี") && view.undo && view.back.includes("บี"), "ถอนนักเรียนออก แล้วกดเลิกทำได้");

  // ── ยิ่งใกล้ยิ่งละเอียด ──
  const gran = await p.evaluate(async () => {
    const tick = (ms) => new Promise((r) => setTimeout(r, ms || 40));
    const t = todayStr(), soon = new Date(Date.now() + 3 * 3600e3 + 120e3);
    const pad = (n) => String(n).padStart(2, "0");
    const mk = (id, date, time) => ({ id, title: "t" + id, date, time, place: "", note: "", emoji: "⭐", students: [], createdAt: new Date(Date.now() - 864e5).toISOString() });
    S.settings.events.push(mk(85001, addDays(t, 100), "10:00"), mk(85002, addDays(t, 20), "10:00"), mk(85003, addDays(t, 5), "10:00"),
      mk(85004, localISO(soon), pad(soon.getHours()) + ":" + pad(soon.getMinutes())), mk(85005, addDays(t, -3), ""));
    save(); closeModal(); setTab("overview"); renderAll(); await tick();
    const big = (id) => document.querySelector('[data-evcd="' + id + '"]').textContent;
    const tiles = (id) => Array.from(document.querySelectorAll('[data-evtiles="' + id + '"] .ev-tile')).map((e) => (e.classList.contains("z") ? "z" : "") + e.querySelector("b").textContent);
    const r = { far: big(85001), mid: big(85002), near: big(85003), soon: big(85004), past: big(85005), tFar: tiles(85001), tSoon: tiles(85004),
      pastInDetails: !!document.querySelector('#ev-sec details [data-evcd="85005"]') };
    await tick(1300);
    r.soon2 = big(85004);
    // หน้าวันนี้: แถบงานที่ใกล้ที่สุด
    setTab("today"); renderAll(); await tick();
    const mini = document.querySelector("#view-today .ev-mini");
    r.mini = mini ? mini.textContent : "";
    return r;
  });
  ok(/เดือน/.test(gran.far) && !/วัน|ชม/.test(gran.far), "100 วัน: แสดงเป็นเดือน (+สัปดาห์) — “" + gran.far + "”");
  ok(/สัปดาห์/.test(gran.mid) && !/เดือน/.test(gran.mid), "20 วัน: สัปดาห์ + วัน — “" + gran.mid + "”");
  ok(/วัน/.test(gran.near) && !/สัปดาห์/.test(gran.near), "5 วัน: วัน + ชั่วโมง — “" + gran.near + "”");
  ok(/^0[0-9]:\d\d:\d\d/.test(gran.soon) && gran.soon2 !== gran.soon, "ไม่ถึง 2 วัน: นาฬิกาเดินทีละวินาที (" + gran.soon + " → " + gran.soon2 + ")");
  ok(gran.tFar[0] === "3" && gran.tFar.length === 4 && gran.tSoon[0] === "z0" && gran.tSoon[1] === "z0" && gran.tSoon[2] === "z0", "ช่องภาพรวม เดือน › สัปดาห์ › วัน › เวลา (หน่วยที่เป็นศูนย์จางลง) " + gran.tFar.join("|"));
  ok(/ผ่านมาแล้ว 3 วัน/.test(gran.past) && gran.pastInDetails, "งานที่ผ่านแล้ว: “ผ่านมาแล้ว 3 วัน” อยู่ในหมวดงานที่ผ่านมา");
  ok(/t85004/.test(gran.mini) && /\d\d:\d\d:\d\d/.test(gran.mini) && /อีก \d+ งาน/.test(gran.mini), "หน้าวันนี้: แถบงานที่ใกล้ที่สุดพร้อมนับถอยหลัง — " + gran.mini.trim());

  // ── ถอนย้อนหลัง (งานผ่านไปแล้ว) + หน้านักเรียน ──
  const stu = await p.evaluate(async () => {
    const tick = (ms) => new Promise((r) => setTimeout(r, ms || 40));
    const past = S.settings.events.find((e) => e.id === 85005); past.students = ["เอ", "บี"]; save();
    openEvent(85005); await tick();
    document.querySelector('[data-ev-out="เอ"]').click(); await tick();
    const pastAfter = past.students.slice();
    openStudent("เอ"); await tick();
    const blk = document.querySelector("#modal-box .ev-stu");
    const txt = blk ? blk.textContent : "";
    const box = blk && blk.querySelector('[data-ev-join^="' + S.settings.events[0].id + '|"]');
    const was = box && box.checked;
    if (box) box.click(); await tick();
    const left = !S.settings.events[0].students.includes("เอ");
    const box2 = document.querySelector('#modal-box [data-ev-join^="' + S.settings.events[0].id + '|"]');
    if (box2) box2.click(); await tick();
    closeModal();
    return { pastAfter, txt, was, left, back: S.settings.events[0].students.includes("เอ") };
  });
  ok(stu.pastAfter.join() === "บี", "ถอนออกได้แม้งานผ่านไปแล้ว");
  ok(/คอนเสิร์ตปลายปี/.test(stu.txt) && /เรียนอีก 3 ครั้ง/.test(stu.txt) && stu.was && stu.left && stu.back, "หน้านักเรียน: เห็นงานที่เข้าร่วม + ครั้งที่เหลือ ติ๊กถอน/เข้าร่วมได้ทันที");

  // ── หน้าตั้งค่า + ภาษาอังกฤษ ──
  const menu = await p.evaluate(async () => {
    openMenu(); await new Promise((r) => setTimeout(r, 50));
    const row = document.getElementById("ev-row"), grp = row && row.closest(".mt-sec");
    const r = { inGroup: !!grp && /การสอน/.test(grp.textContent) };
    row.click(); await new Promise((r2) => setTimeout(r2, 50));
    r.list = document.querySelectorAll("#modal-box .ev-card").length;
    closeModal();
    window.__i18n = "en"; setTab("overview"); renderAll();
    const sec = document.getElementById("ev-sec").cloneNode(true);
    sec.querySelectorAll("[data-noi18n]").forEach((e) => e.remove());
    r.enThai = (sec.textContent.match(/[ก-ฺเ-๛]+/g) || []);
    r.en = /months|weeks|days/.test(sec.textContent);
    window.__i18n = "th"; renderAll();
    return r;
  });
  ok(menu.inGroup && menu.list >= 5, "⚙ › การสอน › 🎯 งานสำคัญ เปิดรายการงานทั้งหมด");
  ok(menu.en && !menu.enThai.length, "ภาษาอังกฤษ: นับถอยหลังและข้อความเป็นอังกฤษทั้งหมด" + (menu.enThai.length ? " — เหลือ " + menu.enThai.join(",") : ""));
  ok(!errs.length, "ไม่มี error ใน console" + (errs.length ? ": " + errs.join(" | ") : ""));

  await browser.close(); server.close();
  console.log(fail.length ? "\n✗ ไม่ผ่าน " + fail.length + " ข้อ" : "\n✓ ผ่านทั้งหมด");
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
