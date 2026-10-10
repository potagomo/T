#!/usr/bin/env node
/* ตรวจเวลาเรียนประจำของสถานที่ + วางตารางจากไลน์แบบส่วนตัว + "น้อง" หน้าชื่อ
 * (tools/lesson-layer/55-place-time.js, 58-nong.js)
 *
 *   npm i playwright && node tools/test-place-time.js
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
  await p.goto(URL_);
  await p.evaluate(() => { lsSet("td_pw", hashPw("1234")); document.getElementById("pw-input").value = "1234"; doLogin(); });
  await p.waitForFunction(() => document.getElementById("app").style.display === "block");
  ok(await p.evaluate(() => window.__placeTime === "on" && window.__nong === "on"), "ชั้น 55-place-time และ 58-nong ทำงาน");

  // สถานที่ 50 นาที · ภีมเคยเรียน 45 นาทีที่นี่ · ก้อยมีคอร์สส่วนตัว 1 คอร์ส (45 นาที)
  await p.evaluate(() => {
    S.places.push({ id: 900, name: "PlaySound", rate: 270, payMode: "session", active: true, note: "", dur: 50 / 60 });
    S.students.push({ key: "ภีม", name: "ภีม", code: "S901", aliases: [], age: null, ageAt: "", startDate: "2026-09-01", note: "" });
    S.students.push({ key: "ก้อย", name: "ก้อย", code: "S902", aliases: [], age: null, ageAt: "", startDate: "2026-09-01", note: "" });
    S.lessons.push({ id: 91001, date: "2026-10-03", time: "08:00", kind: "school", duration: 0.75, rate: 270, payMode: "session", heads: 1, courseId: null, placeId: 900,
      student: "ภีม", topic: "Groove", notes: "", videoLink: "", nextLesson: "", media: null, scores: [], practiceItems: [], attendance: "present", updatedAt: nowISO() });
    S.courses.push({ id: 92001, student: "ก้อย", name: "คอร์ส 10 ครั้ง", sessions: 10, price: 5000, hoursPer: 0.75, startDate: "2026-09-01", active: true });
    migrate(); save();
  });

  // ── ฟอร์ม + เพิ่ม ──
  const form = await p.evaluate(async () => {
    const tick = () => new Promise((r) => setTimeout(r, 30));
    openAdd(); await tick();
    const r = { start: Math.round(EF.duration * 60), clean: !lessonDirty() };
    r.chip = (document.querySelector("#dur-school-chips .durchip.on") || {}).textContent;
    onStudentInput("ภีม"); await tick();
    r.prev = Math.round(EF.duration * 60);
    r.hint = /เท่าครั้งก่อนของ ภีม/.test(document.getElementById("pay-block").textContent);
    onStudentInput("น้องใหม่"); await tick();
    r.newStu = Math.round(EF.duration * 60);
    setDur_school(60, true); onStudentInput("ภีม"); await tick();
    r.touched = Math.round(EF.duration * 60);
    r.btn = /ตั้งราคาและเวลานี้เป็นค่าประจำของ PlaySound/.test(document.getElementById("pay-block").textContent);
    LESSON_OPEN = false; closeModal();
    return r;
  });
  ok(form.start === 50 && form.chip === "50" && form.clean, "เพิ่มคาบใหม่: เริ่มที่ 50 นาทีตามสถานที่ ไม่นับว่ามีการแก้ (" + JSON.stringify(form) + ")");
  ok(form.prev === 45 && form.hint, "นักเรียนเดิม: ใช้เวลาเท่าครั้งก่อน (45 นาที) พร้อมบอกที่มา");
  ok(form.newStu === 50, "เปลี่ยนเป็นนักเรียนใหม่: กลับเป็นเวลาปกติของสถานที่");
  ok(form.touched === 60, "ครูกดเลือกเวลาเองแล้ว ไม่ถูกเปลี่ยนทับ");
  ok(form.btn, "ปุ่มตั้งค่าประจำบอกว่าบันทึกทั้งราคาและเวลา");

  // ── หน้าแก้สถานที่ ──
  const place = await p.evaluate(async () => {
    openEditPlace(900); await new Promise((r) => setTimeout(r, 30));
    const has = !!document.getElementById("pf-dur") && (document.querySelector("#dur-place-chips .durchip.on") || {}).textContent === "50";
    setDur_place(45, true); savePlace();
    const row = document.getElementById("modal-box").textContent;
    closeModal();
    return { has, dur: Math.round(getPlace(900).dur * 60), row: /270.*45 นาที/.test(row) };
  });
  ok(place.has && place.dur === 45 && place.row, "หน้าแก้สถานที่มีช่องเวลาเรียนปกติ บันทึกได้ และรายการสถานที่แสดง “45 นาที”");
  await p.evaluate(() => { getPlace(900).dur = 50 / 60; save(); });

  // ── ยังไม่ได้ตั้งเวลาปกติ: เดาจากคาบที่สอนจริง ──
  const guess = await p.evaluate(() => {
    S.places.push({ id: 901, name: "Sangtian", rate: 300, payMode: "session", active: true, note: "" });
    const mk = (i, d) => ({ id: 93000 + i, date: "2026-09-" + String(10 + i).padStart(2, "0"), time: "09:00", kind: "school", duration: d, rate: 300, payMode: "session", heads: 1,
      courseId: null, placeId: 901, student: "เด็ก" + i, topic: "x", notes: "", videoLink: "", nextLesson: "", media: null, scores: [], practiceItems: [], attendance: "present", updatedAt: nowISO() });
    const a = __placeDur(getPlace(901));                                   // ยังไม่มีคาบ → 60
    S.lessons.push(mk(1, 50 / 60), mk(2, 50 / 60), mk(3, 1), mk(4, 50 / 60));
    const b = __placeDur(getPlace(901));                                   // ส่วนใหญ่ 50 → 50
    const r = lessonFromRosterEntry({ student: "คนใหม่", day: 1, time: "09:00", kind: "school", placeId: 901 }, "2026-10-19");
    S.lessons = S.lessons.filter((l) => l.placeId !== 901); S.places = S.places.filter((x) => x.id !== 901); save();
    return [Math.round(a * 60), Math.round(b * 60), Math.round(r.duration * 60)];
  });
  ok(guess.join() === "60,50,50", "สถานที่ที่ยังไม่ตั้งเวลา: ใช้ความยาวที่สอนบ่อยที่สุดที่นั่น (" + guess + ")");

  // ── ตารางประจำ ──
  const roster = await p.evaluate(() => {
    const a = lessonFromRosterEntry({ student: "หน้าใหม่", day: 6, time: "09:00", kind: "school", placeId: 900 }, "2026-10-17");
    const b = lessonFromRosterEntry({ student: "ภีม", day: 6, time: "08:00", kind: "school", placeId: 900 }, "2026-10-17");
    return [Math.round(a.duration * 60), Math.round(b.duration * 60)];
  });
  ok(roster[0] === 50 && roster[1] === 45, "ตารางประจำ: คนใหม่ 50 นาทีตามสถานที่ · คนเดิมเท่าครั้งก่อน (" + roster + ")");

  // ── วางตารางจากไลน์ (โรงเรียน) ──
  const imp = await p.evaluate(async () => {
    const tick = (ms) => new Promise((r) => setTimeout(r, ms || 60));
    openPasteImport(); await tick();
    const sel = document.querySelector("#modal-box select");
    const hasPriv = !!sel.querySelector('option[value="private"]');
    sel.value = "900"; sel.dispatchEvent(new Event("change"));
    await tick();
    onImportText("วันเสาร์ 17/10/2569\n08.00 ภีม\n10.30 ซีซี"); await tick(400);
    const hint = (document.getElementById("pi-dur-hint") || {}).textContent || "";
    const prev = document.getElementById("pi-preview").textContent;
    PI.entries.forEach((e, i) => { PI.ack[i] = true; });
    applyImport(); await tick(800);
    const got = S.lessons.filter((l) => l.date === "2026-10-17" && l.importedAt).map((l) => [l.student, l.kind, l.placeId, Math.round(l.duration * 60)]);
    return { hasPriv, hint, prev: /50 นาที/.test(prev) && /45 นาที/.test(prev), got };
  });
  const g = Object.fromEntries(imp.got.map((x) => [x[0], x]));
  ok(imp.hasPriv, "วางตารางจากไลน์: ช่องสถานที่มีตัวเลือก “ส่วนตัว (คอร์ส)”");
  ok(/คาบใหม่ 50 นาที/.test(imp.hint) && imp.prev, "บอกความยาวคาบใหม่ และตัวอย่างแสดงเวลาของแต่ละคน");
  ok(g["ภีม"] && g["ภีม"][3] === 45 && g["ซีซี"] && g["ซีซี"][3] === 50 && g["ซีซี"][2] === 900, "ลงคาบ: ภีม (เดิม) 45 นาที · ซีซี (ใหม่) 50 นาที ที่ PlaySound — " + JSON.stringify(imp.got));

  // ── วางตารางจากไลน์ (ส่วนตัว) ──
  const priv = await p.evaluate(async () => {
    const tick = (ms) => new Promise((r) => setTimeout(r, ms || 60));
    closeModal(); openPasteImport(); await tick();
    const sel = document.querySelector("#modal-box select");
    sel.value = "private"; sel.dispatchEvent(new Event("change")); await tick();
    onImportText("วันอาทิตย์ 18/10/2569\n15.00 ก้อย\n16.00 ภีม"); await tick(400);
    const keep = document.querySelector("#modal-box select").value;
    const hint = (document.getElementById("pi-dur-hint") || {}).textContent || "";
    PI.entries.forEach((e, i) => { PI.ack[i] = true; });
    applyImport(); await tick(800);
    const got = S.lessons.filter((l) => l.date === "2026-10-18" && l.importedAt).map((l) => ({ s: l.student, k: l.kind, p: l.placeId, c: l.courseId, m: Math.round(l.duration * 60) }));
    // ลงซ้ำ: มีแล้ว ไม่สร้างเพิ่ม · คาบโรงเรียนวันเดียวกันไม่ถูกแตะ
    openPasteImport(); await tick();
    const sel2 = document.querySelector("#modal-box select"); sel2.value = "private"; sel2.dispatchEvent(new Event("change")); await tick();
    onImportText("วันอาทิตย์ 18/10/2569\n15.00 ก้อย"); await tick(400);
    const again = planAll().plans.map((x) => x.act);
    closeModal();
    return { keep, hint, got, again };
  });
  const k = priv.got.find((x) => x.s === "ก้อย"), b = priv.got.find((x) => x.s === "ภีม");
  ok(priv.keep === "private" && /ส่วนตัว/.test(priv.hint), "เลือก “ส่วนตัว” แล้วช่องยังจำค่าไว้หลังอ่านข้อความ");
  ok(k && k.k === "private" && k.p == null && k.c === 92001 && k.m === 45, "คาบส่วนตัว: ผูกคอร์สของก้อยให้ และใช้เวลาตามคอร์ส 45 นาที — " + JSON.stringify(priv.got));
  ok(b && b.k === "private" && b.p == null, "นักเรียนโรงเรียนที่ลงแบบส่วนตัวเป็นคาบส่วนตัวจริง ไม่ถูกเติมสถานที่");
  ok(priv.again.join() === "skip", "วางข้อความเดิมซ้ำ: เห็นว่ามีคาบส่วนตัวแล้ว ไม่สร้างซ้ำ (" + priv.again + ")");

  // ── “น้อง” หน้าชื่อ ──
  const nong = await p.evaluate(async () => {
    const l = S.lessons.find((x) => x.id === 91001);
    const st = styleOfPreset(resolvePreset(l).id);
    const text = shareText(l, st);
    const custom = shareText(l, Object.assign({}, st, { greeting: "สวัสดีค่ะคุณแม่น้อง{ชื่อ}" }));
    const plain = displayName("ภีม");
    // รูปการ์ด: เก็บข้อความที่วาดลง canvas
    const drawn = []; const orig = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (t) { drawn.push(String(t)); return orig.apply(this, arguments); };
    try { await buildReportCard(l, 1, 1); } finally { CanvasRenderingContext2D.prototype.fillText = orig; }
    const en = window.__nongName("Harvey"), twice = window.__nongName("น้องเจมส์");
    S.settings.nong = false;
    const off = shareText(l, st);
    S.settings.nong = true;
    return { text: /น้องภีม/.test(text), custom: /คุณแม่น้องภีม/.test(custom) && !/น้องน้อง/.test(custom), plain, card: drawn.some((t) => /น้องภีม/.test(t)), en, twice, off: !/น้องภีม/.test(off) && /ภีม/.test(off) };
  });
  ok(nong.text && nong.card, "ข้อความ LINE และรูปการ์ดเรียก “น้องภีม”");
  ok(nong.plain === "ภีม", "ในแอปยังแสดงชื่อเดิม “ภีม”");
  ok(nong.custom && nong.twice === "น้องเจมส์" && nong.en === "น้อง Harvey", "ไม่เติมซ้ำ (แม่แบบ “น้อง{ชื่อ}”, ชื่อที่มีน้องอยู่แล้ว) · ชื่ออังกฤษเว้นวรรค");
  ok(nong.off, "ปิดตัวเลือกแล้วกลับเป็นชื่อเดิม");
  const menu = await p.evaluate(async () => {
    openMenu(); await new Promise((r) => setTimeout(r, 50));
    const row = document.getElementById("nong-row");
    const grp = row && row.closest(".mt-sec"); const title = grp ? grp.textContent : "";
    row.click();
    const offNow = S.settings.nong === false;
    row.click(); closeModal();
    return { inGroup: /ส่งผู้ปกครองและหน้าตา/.test(title), offNow, back: S.settings.nong !== false };
  });
  ok(menu.inGroup && menu.offNow && menu.back, "หน้าตั้งค่า: แถว “เรียก น้อง” อยู่หมวดส่งผู้ปกครอง แตะสลับเปิด/ปิดได้");
  ok(!errs.length, "ไม่มี error ใน console" + (errs.length ? ": " + errs.join(" | ") : ""));

  await browser.close(); server.close();
  console.log(fail.length ? "\n✗ ไม่ผ่าน " + fail.length + " ข้อ" : "\n✓ ผ่านทั้งหมด");
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
