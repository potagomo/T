#!/usr/bin/env node
/* ตรวจวางตารางจากข้อความของแอปไหนก็ได้ + เวลาตารางประจำตามข้อความ
 * (tools/lesson-layer/56-paste-text.js, 57-roster-time.js)
 *
 *   npm i playwright && node tools/test-paste-roster.js
 *
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
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split("?")[0]);
  if (!rel.startsWith(PREFIX)) { res.writeHead(404); return res.end(); }
  rel = rel.slice(PREFIX.length); if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const f = path.join(ROOT, rel);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});

// ข้อความตารางเดียวกันจากหลายแอป — ต้องอ่านได้ "16:00 harvey · 17:00 โค้ช" วันพฤหัส 16/10 เหมือนกันหมด
const APPS = {
  "LINE (คัดลอกข้อความ)": "ขออนุญาตอัพเดตตารางสอนคุณครูค่ะ\n\nวันพฤหัส 16/10\n\n16.00 harvey\n17.00 โค้ช\n\nแอดมินโบว์ค่ะ",
  "LINE (บันทึกแชท .txt)": "[LINE] ประวัติการแชทกับ PlaySound\nบันทึกเมื่อ: 14/10/2569 09:30\n\n2026.10.14 วันอังคาร\n09:15\tแอดมินโบว์\t\"ขออนุญาตอัพเดตตารางค่ะ\nวันพฤหัส 16/10\n16.00 harvey\n17.00 โค้ช\"\n09:20\tครูต้า\tรับทราบครับ",
  "WhatsApp (Android)": "14/10/69 09:15 - แอดมินโบว์: ขออนุญาตอัพเดตตารางสอนคุณครูค่ะ\n14/10/69 09:16 - แอดมินโบว์: วันพฤหัส 16/10\n16.00 harvey\n17.00 โค้ช",
  "WhatsApp (iPhone)": "[14/10/2569 09:15:22] แอดมินโบว์: วันพฤหัส 16/10\n[14/10/2569 09:15:40] แอดมินโบว์: 16.00 harvey\n17.00 โค้ช",
  "WhatsApp (อังกฤษ)": "[10/14/26, 9:15:22 AM] Admin Bow: Thu 16/10\n[10/14/26, 9:15:40 AM] Admin Bow: 4:00 pm harvey\n[10/14/26, 9:15:41 AM] Admin Bow: 5 pm โค้ช",
  "Telegram": "แอดมินโบว์, [14.10.2026 09:15]\nวันพฤหัส 16/10\n16.00 harvey\n\nแอดมินโบว์, [14.10.2026 09:16]\n17.00 โค้ช",
  "Messenger": "แอดมินโบว์\nวันพฤหัส 16/10\n16.00 harvey\n17.00 โค้ช\nส่งเมื่อ 09:15",
  "Google Sheets": "วันพฤหัส 16/10\t\t\n16:00\tharvey\t\n17:00\tโค้ช\t",
  "Sheets (คอลัมน์วันที่)": "16/10/2026\t16:00\tharvey\n16/10/2026\t17:00\tโค้ช",
  "อีเมล (อ้างข้อความ)": "> วันพฤหัส 16/10\n> 16.00 harvey\n> 17.00 โค้ช",
  "โน้ต (เลขข้อ)": "วันพฤหัส 16/10\n1) 16.00 harvey\n2. 17.00 โค้ช",
  "สัญลักษณ์หัวข้อ": "📅 วันพฤหัส 16/10\n▪️ 16.00 harvey\n➤ 17.00 โค้ช",
  "ตัวเลขเต็มความกว้าง": "วันพฤหัส １６/１０\n１６：００ harvey\n１７：００ โค้ช",
  "ขึ้นบรรทัดแบบ iOS (U+2028)": "วันพฤหัส 16/10 16.00 harvey 17.00 โค้ช"
};

(async () => {
  await new Promise((r) => server.listen(0, r));
  const URL_ = "http://localhost:" + server.address().port + PREFIX + "lesson/";
  const browser = await chromium.launch({ executablePath: chromiumPath() });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 880 }, serviceWorkers: "block" });
  const p = await ctx.newPage(); const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(URL_);
  ok(await p.evaluate(() => window.__pasteText === "on" && window.__rosterTime === "on"), "ชั้น 56-paste-text และ 57-roster-time ทำงาน");

  // ── อ่านข้อความจากแอปต่าง ๆ ──
  const parsed = await p.evaluate((APPS) => {
    const out = {};
    const known = [{ canon: "harvey", names: ["harvey"] }, { canon: "โค้ช", names: ["โค้ช"] }];
    for (const k in APPS) {
      const r = parseSchedule(APPS[k], "2026-10-14", { teacher: "ครูต้า", known, ignore: [] });
      out[k] = r.entries.map((e) => e.date + " " + e.time + " " + e.name.toLowerCase()).sort().join(" | ");
    }
    const bad = []; PARSER_CORPUS.forEach((c) => { let x; try { x = parserCheck(c); } catch (e) { x = [e.message]; } if (x.length) bad.push(c.n); });
    return { out, corpus: PARSER_CORPUS.length, bad };
  }, APPS);
  const want = "2026-10-16 16:00 harvey | 2026-10-16 17:00 โค้ช";
  const wrong = Object.keys(parsed.out).filter((k) => parsed.out[k] !== want);
  ok(!wrong.length, "อ่านตารางจาก " + Object.keys(APPS).length + " รูปแบบได้ตรงกันหมด (LINE · WhatsApp · Telegram · Messenger · Sheets · อีเมล · โน้ต …)" +
    (wrong.length ? " — ผิด: " + wrong.map((k) => k + " → " + parsed.out[k]).join(" ; ") : ""));
  ok(!parsed.bad.length, "ชุดทดสอบเดิมของตัวอ่าน " + parsed.corpus + " ชุดยังผ่านทั้งหมด" + (parsed.bad.length ? " — " + parsed.bad.join(", ") : ""));

  // ── สถานการณ์จริง: ตารางประจำไม่มีเวลา → คาบอัตโนมัติทับกันที่ 10:00 ──
  await p.evaluate(() => {
    lsSet("td_pw", hashPw("1234"));
    const t = todayStr(), wdOf = (d) => new Date(d + "T00:00:00").getDay();
    // วันพฤหัสถัดไป (อย่างน้อยพรุ่งนี้) และพฤหัสที่ผ่านมา
    let thu = addDays(t, 1); while (wdOf(thu) !== 4) thu = addDays(thu, 1);
    const pastThu = addDays(thu, -14);
    const place = { id: 7001, name: "PlaySound Chonburi", rate: 270, payMode: "session", active: true, note: "", dur: 50 / 60 };
    const L = (id, who, date, time, extra) => Object.assign({ id, date, time, kind: "school", duration: 50 / 60, rate: 270, payMode: "session", heads: 1, courseId: null, placeId: 7001,
      student: who, topic: "", notes: "", videoLink: "", nextLesson: "", media: null, scores: [], practiceItems: [], attendance: "present", subNote: "", subLinks: [], updatedAt: nowISO() }, extra || {});
    const lessons = [
      L(1, "harvey", pastThu, "16:00", { importedAt: nowISO() }),        // ลงครั้งแรกจากการวางข้อความ
      L(2, "โค้ช", pastThu, "17:00", { importedAt: nowISO() }),
      L(3, "ณิชา", pastThu, "14:00", { importedAt: nowISO() }),
      // คาบที่ระบบลงอัตโนมัติไว้แล้วที่ 10:00 (ทับกัน) — หนึ่งคาบครูกดยืนยันไปแล้ว
      L(10, "harvey", thu, "10:00", { attendance: "planned", auto: true, rosterId: 801, rosterDate: thu }),
      L(11, "โค้ช", thu, "10:00", { attendance: "present", auto: true, rosterId: 802, rosterDate: thu }),
      L(12, "ณิชา", thu, "15:00", { attendance: "planned", auto: true, rosterId: 803, rosterDate: thu })
    ];
    const schedule = [
      { id: 801, student: "harvey", day: 4, time: "", kind: "school", placeId: 7001, note: "" },
      { id: 802, student: "โค้ช", day: 4, time: "", kind: "school", placeId: 7001, note: "" },
      { id: 803, student: "ณิชา", day: 4, time: "15:00", kind: "school", placeId: 7001, note: "" }   // ครูตั้งเวลาเอง → ไม่แตะ
    ];
    localStorage.setItem("td_lessons", JSON.stringify(lessons));
    localStorage.setItem("td_schedule", JSON.stringify(schedule));
    localStorage.setItem("td_places", JSON.stringify([place]));
    localStorage.setItem("td_students", JSON.stringify(["harvey", "โค้ช", "ณิชา"].map((n, i) => ({ key: n, name: n, code: "S00" + (i + 1), aliases: [], age: null, ageAt: "", startDate: "", note: "" }))));
    window.__thu = thu;
  });
  const thu = await p.evaluate(() => window.__thu);
  await p.reload();
  await p.evaluate(() => startApp());
  await p.waitForFunction(() => document.getElementById("app").style.display === "block");
  await p.waitForTimeout(1200);
  const fixd = await p.evaluate((thu) => {
    const at = (who, d) => S.lessons.filter((l) => l.student === who && l.date === d).map((l) => l.time).join(",");
    const sch = (id) => { const e = S.schedule.find((x) => x.id === id); return e.time + "/" + (e.timeFrom || ""); };
    const later = addDays(thu, 7);
    return { h: at("harvey", thu), k: at("โค้ช", thu), n: at("ณิชา", thu), h2: at("harvey", later), k2: at("โค้ช", later),
      sh: sch(801), sk: sch(802), sn: sch(803), toast: (document.getElementById("toast") || {}).textContent || "",
      overlap: S.lessons.filter((l) => l.date === thu && l.time === "10:00").length };
  }, thu);
  ok(fixd.sh === "16:00/paste" && fixd.sk === "17:00/paste", "เปิดแอป: ตารางประจำที่ไม่มีเวลาได้เวลาจากข้อความที่วางครั้งแรก (harvey " + fixd.sh + " · โค้ช " + fixd.sk + ")");
  ok(fixd.h === "16:00" && fixd.k === "17:00" && fixd.overlap === 0, "คาบอัตโนมัติที่ทับกัน 10:00 เปลี่ยนเป็นเวลาจริง (รวมคาบที่ยืนยันแล้วของวันหน้า) — harvey " + fixd.h + " · โค้ช " + fixd.k);
  ok(fixd.h2 === "16:00" && fixd.k2 === "17:00", "คาบที่ลงล่วงหน้าสัปดาห์ถัดไปใช้เวลาจริงตั้งแต่ต้น (" + fixd.h2 + " · " + fixd.k2 + ")");
  ok(fixd.sn === "15:00/" && fixd.n === "15:00", "ตารางประจำที่ครูตั้งเวลาเองไม่ถูกเปลี่ยน (ณิชา 15:00 แม้ข้อความเก่าเป็น 14:00)");
  ok(/ตั้งเวลาตารางประจำ 2 คน/.test(fixd.toast), "บอกครูว่าปรับให้แล้ว: “" + fixd.toast.trim() + "”");

  // ── วางตารางรอบใหม่: harvey เปลี่ยนเป็น 16:30 → ตารางประจำตาม · เลิกทำแล้วย้อนครบ ──
  const imp = await p.evaluate(async (thu) => {
    const tick = (ms) => new Promise((r) => setTimeout(r, ms || 60));
    const d = new Date(thu + "T00:00:00"), msg = "วันพฤหัส " + d.getDate() + "/" + (d.getMonth() + 1) + "\n16.30 harvey\n17.00 โค้ช";
    openPasteImport(); await tick();
    const title = document.querySelector("#modal-box .mtitle").textContent, hint = document.querySelector("#modal-box .hint").textContent;
    onImportText(msg); await tick(400);
    PI.entries.forEach((e, i) => { PI.ack[i] = true; });
    applyImport(); await tick(800);
    const later = addDays(thu, 7);
    const r = { title, hint, sch: S.schedule.find((x) => x.id === 801).time, now: S.lessons.find((l) => l.id === 10).time,
      later: S.lessons.filter((l) => l.student === "harvey" && l.date === later).map((l) => l.time).join(",") };
    const undo = Array.from(document.querySelectorAll("#toast button, button")).find((b) => b.textContent.trim() === "เลิกทำ");
    if (undo) undo.click(); await tick(200);
    r.undoSch = S.schedule.find((x) => x.id === 801).time; r.undoNow = S.lessons.find((l) => l.id === 10).time;
    r.undoLater = S.lessons.filter((l) => l.student === "harvey" && l.date === later).map((l) => l.time).join(",");
    r.undoMark = !S.lessons.find((l) => l.id === 10).importedAt;
    return r;
  }, thu);
  ok(imp.title === "วางตารางจากข้อความ" && /แอปไหนก็ได้/.test(imp.hint), "หน้าวางตาราง: “" + imp.title + "” บอกว่าวางจากแอปไหนก็ได้");
  ok(imp.sch === "16:30" && imp.now === "16:30" && imp.later === "16:30", "วางข้อความใหม่ (harvey 16:30): คาบสัปดาห์นี้ + ตารางประจำ + คาบสัปดาห์หน้าเปลี่ยนตาม");
  ok(imp.undoSch === "16:00" && imp.undoNow === "16:00" && imp.undoLater === "16:00" && imp.undoMark, "กดเลิกทำ: ย้อนกลับทั้งคาบและตารางประจำ");

  // ── ครูแก้เวลาในตารางประจำเอง → วางข้อความครั้งต่อไปไม่ทับ ──
  const manual = await p.evaluate(async (thu) => {
    const tick = (ms) => new Promise((r) => setTimeout(r, ms || 60));
    updateScheduleEntry(801, { time: "18:00" });
    const flag = S.schedule.find((x) => x.id === 801).timeFrom;
    const d = new Date(thu + "T00:00:00");
    openPasteImport(); await tick();
    onImportText("วันพฤหัส " + d.getDate() + "/" + (d.getMonth() + 1) + "\n16.45 harvey"); await tick(400);
    PI.entries.forEach((e, i) => { PI.ack[i] = true; });
    applyImport(); await tick(800);
    return { flag: flag === undefined, sch: S.schedule.find((x) => x.id === 801).time };
  }, thu);
  ok(manual.flag && manual.sch === "18:00", "ครูตั้งเวลาเองในตารางประจำ (18:00): วางข้อความครั้งต่อไปไม่เปลี่ยนตารางประจำ");

  // ── ป้ายชื่อทั่วแอป: ไม่ผูกกับ LINE ──
  const labels = await p.evaluate(async () => {
    const tick = (ms) => new Promise((r) => setTimeout(r, ms || 60));
    closeModal(); setTab("today"); renderAll(); await tick();
    const today = Array.from(document.querySelectorAll("#view-today button")).map((b) => b.textContent).join("|");
    openMenu(); await tick();
    const menu = document.getElementById("modal-box").textContent;
    const groupOk = !!Array.from(document.querySelectorAll("#modal-box .mt-sec")).find((g) => /การสอน/.test(g.textContent) && /วางตารางจากข้อความ/.test(g.textContent));
    closeModal(); openStudentProfile("harvey"); await tick();
    const ph = Array.from(document.querySelectorAll("#modal-box input")).map((i) => i.placeholder).join("|");
    closeModal();
    return { today, menu, groupOk, ph, anyLine: /วางตารางจากไลน์/.test(document.body.innerText + today + menu + ph) };
  });
  ok(/วางตารางจากข้อความ/.test(labels.today) && /วางตารางจากข้อความ/.test(labels.menu) && labels.groupOk && /ตอนวางตาราง/.test(labels.ph) && !labels.anyLine,
    "ปุ่มหน้าวันนี้ แถวในตั้งค่า (หมวดการสอน) และคำแนะนำชื่อเล่น ใช้ “วางตารางจากข้อความ” ไม่มีคำว่าไลน์");

  ok(!errs.length, "ไม่มี error ใน console" + (errs.length ? ": " + errs.join(" | ") : ""));
  await browser.close(); server.close();
  console.log(fail.length ? "\n✗ ไม่ผ่าน " + fail.length + " ข้อ" : "\n✓ ผ่านทั้งหมด");
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
