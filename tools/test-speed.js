#!/usr/bin/env node
/* ตรวจชั้นความเร็ว (tools/lesson-layer/02-speed.js): เร็วขึ้นแต่ผลต้องเหมือนตัวเดิมทุกอย่าง
 *
 *   npm i playwright && node tools/test-speed.js
 *
 * ใช้ข้อมูลชุดเดียวกับ tools/perf-lesson.js (คาบ ~3,300 · นักเรียน 80 มีรูป 40)
 * ออก 0 = ผ่าน, 1 = ไม่ผ่าน
 */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");

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
// เซิร์ฟเวอร์ทดสอบจำลองเน็ตช้าได้: NET.delay (ms) หน่วงหน้าแอป · NET.mark ใส่ป้ายรุ่นลงในหน้า
const NET = { delay: 0, mark: "" };
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split("?")[0]);
  if (!rel.startsWith(PREFIX)) { res.writeHead(404); return res.end(); }
  rel = rel.slice(PREFIX.length); if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const f = path.join(ROOT, rel);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  const send = () => {
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store" });
    if (rel === "lesson/index.html" && NET.mark) return res.end(fs.readFileSync(f, "utf8").replace("<head>", "<head><meta name=\"build-mark\" content=\"" + NET.mark + "\">"));
    fs.createReadStream(f).pipe(res);
  };
  if (rel === "lesson/index.html" && NET.delay) setTimeout(send, NET.delay); else send();
});
const src = fs.readFileSync(path.join(__dirname, "perf-lesson.js"), "utf8");
const dataset = new Function("Buffer", src.slice(src.indexOf("function dataset()"), src.indexOf("const median")) + "; return dataset;")(Buffer);

(async () => {
  await new Promise((r) => server.listen(0, r));
  const URL_ = "http://localhost:" + server.address().port + PREFIX + "lesson/";
  const browser = await chromium.launch({ executablePath: chromiumPath() });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 880 }, serviceWorkers: "block" });
  const p = await ctx.newPage(); const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  const D = dataset();
  await p.goto(URL_);
  await p.evaluate((D) => {
    // เพิ่มกรณีพิเศษให้ตัวตรวจประเภทคาบ: คาบส่วนตัวไม่ผูกคอร์ส · คาบซ้ำวันเวลาเดียวกันคนละประเภท · คาบที่ตรวจแล้ว · คอร์สของคนอื่น
    const L = D.lessons, s0 = D.students[0].key, s1 = D.students[1].key;
    L.push(Object.assign({}, L[10], { id: 990001, kind: "private", courseId: null, placeId: null, student: s0 }));
    const tw = L.find((l) => l.student === s1 && l.kind === "school");
    L.push(Object.assign({}, tw, { id: 990002, kind: "private", courseId: 3000, placeId: null }));
    L.push(Object.assign({}, L[20], { id: 990003, kind: "private", courseId: 999999, placeId: null, kindChecked: true }));
    L.push(Object.assign({}, L[30], { id: 990004, kind: "school", placeId: null }));
    D.enrollments = [{ id: 5001, student: D.students[2].key, placeId: 1001, total: 20, startSession: 1, note: "" }, { id: 5002, student: D.students[3].key, placeId: null, total: 10, startSession: 3, note: "" }];
    for (const [k, v] of [["td_lessons", L], ["td_students", D.students], ["td_places", D.places], ["td_schedule", D.schedule], ["td_courses", D.courses], ["td_photos", D.photos], ["td_enroll", D.enrollments]])
      localStorage.setItem(k, JSON.stringify(v));
  }, D);
  await p.reload();
  await p.evaluate(() => startApp());
  await p.waitForFunction(() => document.getElementById("app").style.display === "block");
  await p.waitForTimeout(1500);
  ok(await p.evaluate(() => window.__speed === "on"), "ชั้น 02-speed ทำงาน");

  // ── ผลเหมือนตัวเดิมทุกฟังก์ชัน ──
  const eq = await p.evaluate(() => {
    const ids = (a) => (a || []).map((l) => l && l.id).join(",");
    const bad = [], O = __speedOrig, N = __speedNew;
    const keys = S.students.map((r) => r.key).concat(["ไม่มีคนนี้"]);
    const today = todayStr(), places = S.places.map((x) => x.id).concat([null]);
    const cmp = (name, a, b) => { if (a !== b) bad.push(name + ": " + String(a).slice(0, 80) + " ≠ " + String(b).slice(0, 80)); };
    keys.forEach((k, i) => {
      cmp("studentHistory " + k, ids(N.studentHistory(k, 0)), ids(O.studentHistory(k, 0)));
      cmp("studentHistory3 " + k, ids(N.studentHistory(k, 3)), ids(O.studentHistory(k, 3)));
      const a = N.studentSummary(k, 3), b = O.studentSummary(k, 3);
      cmp("studentSummary " + k, JSON.stringify([ids(a.shown), a.stats, a.totalEver, a.firstDate, a.lastDate, a.hwTotal, a.hwDone]),
        JSON.stringify([ids(b.shown), b.stats, b.totalEver, b.firstDate, b.lastDate, b.hwTotal, b.hwDone]));
      cmp("studentSince " + k, N.studentSince(k), O.studentSince(k));
      cmp("likelyKind " + k, JSON.stringify(N.likelyKind(k)), JSON.stringify(O.likelyKind(k)));
      places.forEach((pid) => cmp("lastLessonOf " + k + pid, (N.lastLessonOf(k, pid) || {}).id, (O.lastLessonOf(k, pid) || {}).id));
      cmp("slotScore " + k, N.slotScore(k, addDays(today, i % 7), "10:00", 1001), O.slotScore(k, addDays(today, i % 7), "10:00", 1001));
      cmp("lessonsOf " + k, ids(N.lessonsOf(k, S.lessons[i * 7].date)), ids(O.lessonsOf(k, S.lessons[i * 7].date)));
    });
    S.courses.concat([{ id: 999999 }]).forEach((c) => cmp("lessonsOfCourse " + c.id, ids(N.lessonsOfCourse(c.id)), ids(O.lessonsOfCourse(c.id))));
    S.enrollments.forEach((e) => cmp("enrollmentLessons " + e.id, ids(N.enrollmentLessons(e)), ids(O.enrollmentLessons(e))));
    for (let d = -30; d < 30; d++) {
      const iso = addDays(today, d);
      cmp("lessonsOnDate " + iso, ids(N.lessonsOnDate(iso)), ids(O.lessonsOnDate(iso)));
      rosterForDate(iso).forEach((e) => cmp("rosterEntryExists " + iso, N.rosterEntryExists(e, iso), O.rosterEntryExists(e, iso)));
    }
    S.lessons.slice(0, 200).forEach((l) => cmp("previousTaughtLesson " + l.id, (N.previousTaughtLesson(l) || {}).id, (O.previousTaughtLesson(l) || {}).id));
    const ka = kindAudit(), kb = __kindAuditOrig();
    cmp("kindAudit", JSON.stringify(ka.map((x) => [x.l.id, x.why, x.suggest])), JSON.stringify(kb.map((x) => [x.l.id, x.why, x.suggest])));
    return { bad, audit: ka.length };
  });
  ok(!eq.bad.length && eq.audit > 3, "ฟังก์ชันที่เร่งความเร็ว (ประวัตินักเรียน สรุป คอร์ส โควตา คาบรายวัน ตรวจประเภทคาบ " + eq.audit + " รายการ ฯลฯ) ได้ผลเท่าตัวเดิมทุกตัว" + (eq.bad.length ? " — " + eq.bad.slice(0, 3).join(" | ") : ""));

  // ── ดัชนีไม่ค้าง: แก้แล้ว (แม้ในงานเดียวกัน) ต้องเห็นผลใหม่ ──
  const stale = await p.evaluate(() => {
    const k = S.students[5].key, before = studentSummary(k, 0).totalEver;
    const l = Object.assign({}, S.lessons.find((x) => x.student === k), { id: 991001 });
    S.lessons.push(l);                                         // ไม่ได้บันทึก — จำนวนคาบเปลี่ยนต้องรู้เอง
    const added = studentSummary(k, 0).totalEver;
    S.lessons.pop(); save();
    const back = studentSummary(k, 0).totalEver;
    const first = kindAudit()[0].l, a = kindAudit().length;
    first.kindChecked = true; save();                          // ติ๊ก "ตรวจแล้ว" แล้วบันทึก → รายการลดทันที
    const b = kindAudit().length;
    delete first.kindChecked; save();
    return { ok: added === before + 1 && back === before, audit: a === b + 1 };
  });
  ok(stale.ok && stale.audit, "ข้อมูลเปลี่ยนแล้วผลใหม่ทันที (เพิ่มคาบในงานเดียวกัน · บันทึกแล้วตรวจประเภทคาบใหม่) ");

  // ── แท็บบันทึก: ทีละ 40 คาบ ──
  const log = await p.evaluate(async () => {
    const tick = (ms) => new Promise((r) => setTimeout(r, ms || 40));
    setTab("students"); setSub("students", "log"); await tick();
    const r = { first: document.querySelectorAll("#cards-tail .card").length, count: document.getElementById("cards-count").textContent,
      htmlKB: Math.round(document.getElementById("view-students").innerHTML.length / 1024), more: (document.getElementById("cards-more") || {}).textContent || "" };
    document.getElementById("cards-more").click(); await tick();
    r.second = document.querySelectorAll("#cards-tail .card").length;
    // เลื่อนลงจนสุด: เติมเองจนครบ
    for (let i = 0; i < 6; i++) { window.scrollTo(0, document.body.scrollHeight); await tick(150); }
    r.scrolled = document.querySelectorAll("#cards-tail .card").length;
    // ค้นหา (ช่องค้นหาอยู่บนสุด): เริ่มหน้าแรกใหม่ ตัวนับถูก
    window.scrollTo(0, 0); await tick(100);
    onSearch("Paradiddle"); await tick();
    const n = getFiltered().length;
    r.search = { cards: document.querySelectorAll("#cards-tail .card").length, n, count: document.getElementById("cards-count").textContent };
    onSearch(""); await tick();
    // คาบที่กางอยู่ไกลกว่าหน้าแรก ต้องถูกวาดด้วย
    const far = getFiltered()[130];
    S.expanded = far.id; renderAll(); await tick();
    r.expandedShown = !!document.querySelector("#cards-tail [onclick^=\"openReportCard(" + far.id + ")\"]");
    S.expanded = null;
    // หน้าแรกเหมือนตัวเดิมทุกตัวอักษร (เทียบ 40 การ์ดแรก)
    const html40 = getFiltered().slice(0, 40).map(cardHtml).join("");
    renderAll(); await tick();
    r.sameCards = document.getElementById("cards-tail").innerHTML.indexOf(html40.slice(0, 2000)) === 0;
    return r;
  });
  ok(log.first === 40 && /3[0-9]{3} คาบ/.test(log.count) && log.htmlKB < 400 && /แสดงเพิ่ม \(อีก/.test(log.more), "แท็บบันทึกวาด 40 คาบแรก (" + log.htmlKB + " KB · เดิม ~57 MB) ตัวนับยังบอกทั้งหมด " + log.count);
  ok(log.second === 80 && log.scrolled > 80, "กด “แสดงเพิ่ม” ได้อีก 40 · เลื่อนลงแล้วเติมเอง (" + log.second + " → " + log.scrolled + ")");
  ok(log.search.cards === Math.min(40, log.search.n) && log.search.count.indexOf(String(log.search.n)) === 0, "ค้นหาแล้วเริ่มหน้าแรกใหม่ ตัวนับถูก (" + log.search.count + ")");
  ok(log.expandedShown && log.sameCards, "คาบที่กางไว้ (ลำดับที่ 131) ยังถูกวาด · การ์ดหน้าตาเหมือนเดิม");

  // ── รูปนักเรียน: blob: URL สั้น ๆ ──
  const ph = await p.evaluate(async () => {
    const k = Object.keys(S.photos)[0];
    const h = avatarHtml(k, S.photos[k], 40);
    const src = /src="([^"]+)"/.exec(h)[1];
    const img = new Image(); img.src = src; await new Promise((r) => { img.onload = r; img.onerror = r; });
    const old = src; S.photos[k] = "data:image/jpeg;base64," + btoa("x".repeat(6000)); save();
    const src2 = /src="([^"]+)"/.exec(avatarHtml(k, S.photos[k], 40))[1];
    const small = avatarHtml("ไม่มีรูป", "data:image/png;base64,AAAA", 40);
    return { blob: /^blob:/.test(src), len: h.length, loaded: img.naturalWidth >= 0 && img.complete, changed: src2 !== old && /^blob:/.test(src2), small: /data:image\/png;base64,AAAA/.test(small) };
  });
  ok(ph.blob && ph.len < 600 && ph.loaded, "รูปนักเรียนในการ์ดเป็น blob: URL (" + ph.len + " ตัวอักษร · เดิม ~30,000)");
  ok(ph.changed && ph.small, "เปลี่ยนรูปแล้วการ์ดใช้รูปใหม่ · รูปเล็ก/ไอคอนยังใช้แบบเดิม");

  // ── บันทึก: ข้ามรูปที่ไม่เปลี่ยน แต่รูปที่เปลี่ยน/ลบ/ที่เก็บถูกล้าง ต้องเขียนถูกเสมอ ──
  const sv = await p.evaluate(() => {
    const r = {};
    const k = Object.keys(S.photos)[1];
    save(); S.lessons[0].notes = "n1"; save();
    r.lessonSaved = JSON.parse(lsGet("td_lessons"))[0].notes === "n1";
    r.photosIntact = JSON.parse(lsGet("td_photos"))[k] === S.photos[k];
    S.photos[k] = "data:image/jpeg;base64," + btoa("y".repeat(5000)); save();
    r.photoChanged = JSON.parse(lsGet("td_photos"))[k] === S.photos[k];
    delete S.photos[k]; save();
    r.photoDeleted = !(k in JSON.parse(lsGet("td_photos")));
    localStorage.removeItem("td_photos"); S.lessons[0].notes = "n2"; save();
    r.rewrittenAfterWipe = JSON.stringify(JSON.parse(lsGet("td_photos") || "null")) === JSON.stringify(S.photos);
    // เวลา: บันทึกที่รูปไม่เปลี่ยน ไม่แปลงรูปเป็นข้อความ
    const orig = JSON.stringify; let photoStr = 0;
    JSON.stringify = function (v) { if (v === S.photos) photoStr++; return orig.apply(JSON, arguments); };
    try { S.lessons[0].notes = "n3"; save(); } finally { JSON.stringify = orig; }
    r.skipped = photoStr === 0;
    return r;
  });
  ok(sv.lessonSaved && sv.photosIntact && sv.skipped, "บันทึกคาบ: รูปไม่ถูกแปลงซ้ำเมื่อไม่เปลี่ยน และยังอยู่ครบในที่เก็บ");
  ok(sv.photoChanged && sv.photoDeleted && sv.rewrittenAfterWipe, "รูปที่เปลี่ยน/ลบ ถูกบันทึก · ที่เก็บรูปหายไป บันทึกครั้งถัดไปเขียนคืนให้");

  // ── สำเนาสำรอง (mirror): รอหยุดแก้ แล้วเขียน · สลับแอปเขียนทันที ──
  const mir = await p.evaluate(async () => {
    const tick = (ms) => new Promise((r) => setTimeout(r, ms));
    const spy = MDB.put; const keys = [];
    MDB.put = function (k, v) { keys.push(k); return spy.apply(MDB, arguments); };
    await tick(4500);                                          // ให้งานเขียนสำเนาที่ค้างจากขั้นก่อน ๆ เสร็จก่อน
    keys.length = 0;
    S.lessons[0].notes = "m1"; save(); S.lessons[0].notes = "m2"; save();
    await tick(900); const early = keys.filter((k) => k === "state:mirror").length;
    await tick(3500); const later = keys.filter((k) => k === "state:mirror").length;
    S.lessons[0].notes = "m3"; save();
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    await tick(300); const hidden = keys.filter((k) => k === "state:mirror").length;
    delete document.visibilityState;
    MDB.put = spy;
    const m = await MDB.get("state:mirror");
    return { early, later, hidden, last: m && m.lessons && m.lessons[0].notes };
  });
  ok(mir.early === 0 && mir.later === 1, "สำเนาสำรองเขียนครั้งเดียวหลังหยุดแก้ (ไม่เขียนทุกครั้งที่บันทึก)");
  ok(mir.hidden === 2 && mir.last === "m3", "สลับ/ปิดแอประหว่างรอ: เขียนสำเนาทันที ได้ข้อมูลล่าสุด");

  ok(!errs.length, "ไม่มี error ใน console" + (errs.length ? ": " + errs.join(" | ") : ""));

  // ── โหมดกลางคืน: ส่วนที่ซ่อนอยู่แล้วโผล่ (หัวข้อพับ หมวดตั้งค่า การ์ดที่เติมทีหลัง แท็บ) ต้องถูกแปลงสีด้วย ──
  {
    const c3 = await browser.newContext({ viewport: { width: 412, height: 880 }, serviceWorkers: "block" });
    const q = await c3.newPage(); const e3 = [];
    q.on("pageerror", (e) => e3.push(e.message));
    await q.goto(URL_);
    await q.evaluate((D) => {
      for (const [k, v] of [["td_lessons", D.lessons], ["td_students", D.students], ["td_places", D.places], ["td_schedule", D.schedule], ["td_courses", D.courses], ["td_photos", D.photos]])
        localStorage.setItem(k, JSON.stringify(v));
      localStorage.setItem("td_theme", "dark");
    }, D);
    await q.reload(); await q.evaluate(() => startApp()); await q.waitForTimeout(1200);
    const audit = (sel) => q.evaluate((sel) => {
      const P = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s); if (!m) return null; const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
      const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      const L = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
      const over = (t, b) => [t[0] * t[3] + b[0] * (1 - t[3]), t[1] * t[3] + b[1] * (1 - t[3]), t[2] * t[3] + b[2] * (1 - t[3]), 1];
      const bgOf = (el) => { const ch = []; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const c = P(getComputedStyle(n).backgroundColor); if (c && c[3] > 0) { ch.push(c); if (c[3] >= 0.99) break; } }
        let b = ch.length && ch[ch.length - 1][3] >= 0.99 ? ch.pop() : [22, 20, 15, 1]; while (ch.length) b = over(ch.pop(), b); return b; };
      const bad = []; let n = 0;
      document.querySelectorAll(sel).forEach((e) => {
        if (e.closest(".rc-preview,.rcframe,canvas,svg")) return;
        const r = e.getBoundingClientRect(); if (!r.width || !r.height) return;
        if (![...e.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim())) return;
        n++; const a = L(P(getComputedStyle(e).color)), b = L(bgOf(e)), cr = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        if (cr < 3) bad.push(e.textContent.trim().slice(0, 16) + " " + cr.toFixed(1));
      });
      return { n, bad };
    }, sel);
    const frames = () => q.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    const res = [];
    await q.evaluate(() => { openAdd(); const d = document.querySelector("#modal-box details.more"); if (d) d.open = false; });
    await frames();
    await q.evaluate(() => { document.querySelector("#modal-box details.more").open = true; });
    await frames(); await q.waitForTimeout(100);
    res.push(["หัวข้อพับในฟอร์ม", await audit("#modal-box details.more *")]);
    await q.evaluate(() => { LESSON_OPEN = false; closeModal(); openMenu(); });
    await frames();
    await q.evaluate(() => { const h = document.querySelector("#modal-box .mt-sec:not(.open) .mt-head"); if (h) h.click(); });
    await frames(); await q.waitForTimeout(100);
    res.push(["หมวดตั้งค่าที่กาง", await audit("#modal-box .mt-sec.open *")]);
    await q.evaluate(() => { closeModal(); setTab("students"); setSub("students", "log"); });
    await frames();
    await q.evaluate(() => __logShowMore());
    await frames(); await q.waitForTimeout(100);
    const ms = await q.evaluate(() => { const c = document.querySelectorAll("#cards-tail .card"); c[c.length - 1].scrollIntoView(); return c.length; });
    await frames(); await q.waitForTimeout(100);
    res.push(["การ์ดที่เติมจาก “แสดงเพิ่ม” (" + ms + ")", await audit("#cards-tail .card:nth-last-child(-n+12) *")]);
    await q.evaluate(() => { window.scrollTo(0, 0); setTab("overview"); }); await frames();
    await q.evaluate(() => { setTab("today"); }); await frames();
    await q.evaluate(() => { setTab("students"); setSub("students", "people"); }); await frames(); await q.waitForTimeout(100);
    res.push(["สลับแท็บไปมา", await audit("#view-students *")]);
    const bad = res.filter((r) => r[1].bad.length || !r[1].n);
    ok(!bad.length && !e3.length, "โหมดกลางคืน: ส่วนที่โผล่ทีหลังถูกแปลงสี อ่านออกทุกชิ้น (" + res.map((r) => r[0] + " " + r[1].n).join(" · ") + ")" +
      (bad.length ? " — " + bad.map((r) => r[0] + ": " + (r[1].bad.slice(0, 3).join(", ") || "ไม่เจอตัวหนังสือ")).join(" | ") : "") + (e3.length ? " err: " + e3[0] : ""));
    await c3.close();
  }

  // ── Service Worker: เน็ตช้าไม่ต้องรอ ──
  {
    const c2 = await browser.newContext({ viewport: { width: 412, height: 880 }, serviceWorkers: "allow" });
    const q = await c2.newPage();
    await q.goto(URL_, { waitUntil: "load" });
    await q.evaluate(() => startApp());                          // แอปลงทะเบียน Service Worker ตอนเข้าแอป
    await q.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {});
    ok(await q.evaluate(() => !!navigator.serviceWorker.controller), "Service Worker คุมหน้าแอป");
    await q.reload({ waitUntil: "load" });                     // มีสำเนาในเครื่องแล้ว
    const mark = () => q.evaluate(() => (document.querySelector('meta[name="build-mark"]') || {}).content || "").catch(() => "?");
    NET.mark = "v-fast"; await q.reload({ waitUntil: "load" });
    ok(await mark() === "v-fast", "เน็ตปกติ: เปิดได้รุ่นล่าสุดจากเน็ตทันที (เหมือนเดิม)");
    NET.mark = "v-slow"; NET.delay = 6000;
    const t0 = Date.now(); await q.reload({ waitUntil: "domcontentloaded" }); const took = Date.now() - t0;
    const shown = await mark();
    ok(took < 4500 && shown === "v-fast" && /ครูต้า/.test(await q.title()), "เน็ตช้า (หน่วง 6 วินาที): เปิดสำเนาในเครื่องใน " + (took / 1000).toFixed(1) + " วินาที ไม่ต้องรอ");
    await q.waitForTimeout(6500); NET.delay = 0;               // ของใหม่โหลดเสร็จเบื้องหลัง
    await c2.setOffline(true); await q.reload({ waitUntil: "load" }).catch(() => {});
    ok(await mark() === "v-slow", "ของใหม่ที่โหลดเบื้องหลังถูกเก็บไว้ เปิดครั้งถัดไป (แม้ออฟไลน์) ได้รุ่นใหม่");
    await c2.setOffline(false); NET.mark = "";
    await c2.close();
  }
  await browser.close(); server.close();
  console.log(fail.length ? "\n✗ ไม่ผ่าน " + fail.length + " ข้อ" : "\n✓ ผ่านทั้งหมด");
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
