#!/usr/bin/env node
/* ตรวจ "ตัดยอดเงินเดือนแบบสอนโรงเรียน" (tools/lesson-layer/36-paycut.js) ด้วยเบราว์เซอร์จริง
 *
 *   npm i playwright && node tools/test-paycut.js
 *
 * รอบตัดยอด (วันที่ 20 · 30 ในเดือนสั้น · สิ้นเดือน) → หน้ารายได้มีส่วนตัดยอด → ใส่ยอดโรงเรียน เห็นส่วนต่าง
 * → ใช้ยอดโรงเรียน (ปรับให้) → ติ๊กออกคาบ → บันทึก/ซิงค์ · ช่องวันตัดยอดในหน้าแก้สถานที่ · รายได้รวมเดิมไม่เปลี่ยน
 * ออก 0 = ผ่าน, 1 = ไม่ผ่าน
 */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium, devices } = require("playwright");

const ROOT = path.resolve(__dirname, ".."), PREFIX = "/T/";
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json" };
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
  await p.waitForFunction(() => document.getElementById("app").style.display === "block", null, { timeout: 10000 });
  ok(await p.evaluate(() => window.__payCut === "on"), "ชั้นตัดยอดเงินเดือนทำงาน");

  // ── รอบตัดยอด ──
  const cyc = await p.evaluate(() => ({
    c20: __payCycle({ cutoff: 20 }, "2026-10"),
    c30feb: __payCycle({ cutoff: 30 }, "2026-02"), c30mar: __payCycle({ cutoff: 30 }, "2026-03"),
    end: __payCycle({}, "2026-10"), jan: __payCycle({ cutoff: 25 }, "2027-01"),
  }));
  ok(cyc.c20.start === "2026-09-21" && cyc.c20.end === "2026-10-20", "ตัดวันที่ 20: เงินเดือน ต.ค. = 21 ก.ย. – 20 ต.ค.");
  ok(cyc.c30feb.end === "2026-02-28" && cyc.c30mar.start === "2026-03-01" && cyc.c30mar.end === "2026-03-30", "ตัดวันที่ 30: ก.พ. จบ 28 · มี.ค. เริ่ม 1 มี.ค.");
  ok(cyc.end.start === "2026-10-01" && cyc.end.end === "2026-10-31", "ค่าเริ่มต้น = สิ้นเดือน (เดือนปฏิทิน)");
  ok(cyc.jan.start === "2026-12-26" && cyc.jan.end === "2027-01-25", "ข้ามปี: ม.ค. 2027 = 26 ธ.ค. – 25 ม.ค.");

  // ── ข้อมูลทดสอบ: ต่อครั้ง 300 ──
  await p.evaluate(() => {
    S.places.push({ id: 9001, name: "รร.ทดสอบตัดยอด", rate: 300, payMode: "session", active: true, note: "" });
    const mk = (id, date, att) => ({ id, date, time: "16:00", kind: "school", placeId: 9001, duration: 1, rate: 300, payMode: "session", heads: 1,
      attendance: att || "present", student: "ภีม" + id, topic: "", notes: "", scores: [], practiceItems: [], updatedAt: nowISO() });
    S.lessons.push(mk(9101, "2026-09-20"), mk(9102, "2026-09-21"), mk(9103, "2026-10-05"), mk(9104, "2026-10-10", "sick"),
      mk(9105, "2026-10-19", "planned"), mk(9106, "2026-10-20"), mk(9107, "2026-10-21"));
    save();
    setTab("money"); S.sum.mode = "month"; S.sum.place = "ทั้งหมด"; S.sum.period = "2026-10"; renderAll();
  });
  const heroBefore = await p.evaluate(() => document.querySelector("#view-money .bignum").getAttribute("data-count"));
  let row = await p.evaluate(() => { const b = document.querySelector("#paycut .pc-row"); return b && b.textContent; });
  ok(row && /รร\.ทดสอบตัดยอด/.test(row) && /1 ต\.ค\. – 31 ต\.ค\./.test(row) && /฿900/.test(row), "หน้ารายได้มีส่วนตัดยอด (ยังสิ้นเดือน: ต.ค. 3 คาบ ฿900) — " + (row || "").replace(/\s+/g, " ").slice(0, 90));

  // ── ตั้งวันที่ 20 ในหน้าเทียบยอด ──
  await p.evaluate(() => openPayCut(9001, "2026-10"));
  await p.selectOption("#pc-cut", "20");
  ok(await p.evaluate(() => getPlace(9001).cutoff === 20 && !!getPlace(9001).updatedAt), "ตั้งตัดยอดทุกวันที่ 20 → เก็บที่สถานที่ (ซิงค์)");
  let sum = await p.evaluate(() => document.getElementById("pc-sum").textContent);
  ok(/21 ก\.ย\. – 20 ต\.ค\./.test(await p.evaluate(() => document.querySelector("#modal-root .datenav").textContent)), "หัวรอบ: เงินเดือน ต.ค. · 21 ก.ย. – 20 ต.ค.");
  ok(/ตามแอป.*3.*คาบ.*฿900/.test(sum) && /รอยืนยัน 1/.test(sum), "ยอดตามแอป ฿900 (3 คาบ · ลาป่วยไม่คิด · รอยืนยันแยกไว้)");
  ok(/ยังไม่ใส่ยอดโรงเรียน/.test(sum), "ยังไม่ใส่ยอดโรงเรียน");

  await p.fill("#pc-rep", "850");
  sum = await p.evaluate(() => document.getElementById("pc-sum").textContent);
  ok(/โรงเรียนจ่ายน้อยกว่า ฿50/.test(sum), "ใส่ยอดโรงเรียน 850 → โรงเรียนจ่ายน้อยกว่า ฿50");
  await p.click("#pc-use");
  sum = await p.evaluate(() => document.getElementById("pc-sum").textContent);
  const r1 = await p.evaluate(() => S.settings.payCuts["9001|2026-10"]);
  ok(r1 && r1.reported === 850 && r1.adj === -50 && /ยอดโรงเรียน/.test(r1.note), "ใช้ยอดโรงเรียน → ปรับ −฿50 พร้อมเหตุผล");
  ok(/ได้รับจริง\s*฿850/.test(sum) && /✓ ตรงกัน/.test(sum), "ได้รับจริง ฿850 · ✓ ตรงกัน");

  // ── ติ๊กออกคาบที่โรงเรียนไม่นับ ──
  await p.uncheck('#pc-list input[data-id="9106"]');
  sum = await p.evaluate(() => document.getElementById("pc-sum").textContent);
  ok(/ตามแอป.*2.*คาบ.*฿600/.test(sum) && /ติ๊กออก 1/.test(sum) && /ได้รับจริง\s*฿550/.test(sum) && /มากกว่า ฿300/.test(sum),
    "ติ๊กออก 1 คาบ → ตามแอป ฿600 · ได้รับจริง ฿550 · โรงเรียนจ่ายมากกว่า ฿300");
  ok(await p.evaluate(() => (S.settings.payCuts["9001|2026-10"].off || []).join() === "9106"), "จำคาบที่ติ๊กออก");
  await p.check('#pc-list input[data-id="9106"]');
  ok(await p.evaluate(() => !S.settings.payCuts["9001|2026-10"].off), "ติ๊กกลับ → ไม่เหลือรายการติ๊กออก");
  ok(await p.evaluate(() => document.querySelectorAll('#pc-list input[disabled]').length === 1), "คาบรอยืนยันติ๊กไม่ได้ (ยังไม่รวมในยอด)");

  // ── รอบก่อนหน้า / ถัดไป ──
  await p.click("#pc-prev");
  ok(/21 ส\.ค\. – 20 ก\.ย\./.test(await p.evaluate(() => document.querySelector("#modal-root .datenav").textContent)) &&
     /ตามแอป.*1.*คาบ.*฿300/.test(await p.evaluate(() => document.getElementById("pc-sum").textContent)), "‹ รอบ ก.ย. (21 ส.ค. – 20 ก.ย.) มีคาบ 20 ก.ย.");
  await p.click("#pc-next"); await p.click("#pc-next");
  ok(/ตามแอป.*1.*คาบ.*฿300/.test(await p.evaluate(() => document.getElementById("pc-sum").textContent)), "› รอบ พ.ย. มีคาบ 21 ต.ค.");
  await p.click("#pc-prev");
  if (process.env.SHOT_DIR) await p.screenshot({ path: path.join(process.env.SHOT_DIR, "paycut-modal.png"), fullPage: true });

  // ── ปิด → บันทึก + หน้ารายได้ ──
  await p.click("text=เสร็จ");
  ok(await p.evaluate(() => { const s = JSON.parse(localStorage.getItem("td_settings")); return s.payCuts && s.payCuts["9001|2026-10"].reported === 850; }), "กดเสร็จ → บันทึกลงเครื่องแล้ว (ซิงค์กับการตั้งค่า)");
  row = await p.evaluate(() => { const b = document.querySelector("#paycut .pc-row"); return b && b.textContent.replace(/\s+/g, " "); });
  ok(row && /21 ก\.ย\. – 20 ต\.ค\./.test(row) && /ตัดยอดวันที่ 20/.test(row) && /✓ ตรงกัน/.test(row) && /฿850/.test(row), "แถวในหน้ารายได้: รอบใหม่ · ✓ ตรงกัน · ฿850 — " + (row || "").slice(0, 90));
  ok(await p.evaluate(() => document.querySelector("#view-money .bignum").getAttribute("data-count")) === heroBefore, "รายได้รวมของเดือนไม่เปลี่ยน (ยอดปรับอยู่ในรอบตัดยอดเท่านั้น)");
  if (process.env.SHOT_DIR) { await p.waitForTimeout(500); await p.evaluate(() => document.getElementById("paycut").scrollIntoView()); await p.screenshot({ path: path.join(process.env.SHOT_DIR, "paycut-money.png") }); }

  // ── ตัวกรอง: เฉพาะส่วนตัว = ไม่มีส่วนตัดยอด · รายปี = รวม ──
  await p.evaluate(() => { S.sum.place = "ส่วนตัว"; renderAll(); });
  ok(await p.evaluate(() => !document.getElementById("paycut")), "ดูเฉพาะส่วนตัว → ไม่มีส่วนตัดยอด");
  await p.evaluate(() => { S.sum.place = "ทั้งหมด"; S.sum.mode = "year"; S.sum.period = "2026"; renderAll(); });
  row = await p.evaluate(() => { const b = document.querySelector("#paycut .pc-row"); return b && b.textContent.replace(/\s+/g, " "); });
  ok(row && /แจ้งแล้ว 1 รอบ/.test(row) && /฿1,450/.test(row), "รายปี: รวมทุกรอบ ฿1,450 · โรงเรียนแจ้งแล้ว 1 รอบ — " + (row || "").slice(0, 80));

  // ── หน้าแก้สถานที่ ──
  await p.evaluate(() => openEditPlace(9001));
  ok(await p.evaluate(() => document.getElementById("pf-cut-sel") && document.getElementById("pf-cut-sel").value === "20"), "หน้าแก้สถานที่มีช่อง “ตัดยอดเงินเดือนทุก” = วันที่ 20");
  await p.selectOption("#pf-cut-sel", "31");
  await p.evaluate(() => savePlace());
  ok(await p.evaluate(() => !getPlace(9001).cutoff && __payCycle(getPlace(9001), "2026-10").end === "2026-10-31"), "เปลี่ยนเป็นสิ้นเดือนแล้วบันทึก → กลับเป็นเดือนปฏิทิน");
  await p.evaluate(() => { closeModal(); openEditPlace(9001); });
  await p.selectOption("#pf-cut-sel", "25");
  await p.evaluate(() => savePlace());
  ok(await p.evaluate(() => getPlace(9001).cutoff === 25 && JSON.parse(localStorage.getItem("td_places")).find((x) => x.id === 9001).cutoff === 25), "ตั้งวันที่ 25 จากหน้าแก้สถานที่ → บันทึกแล้ว");

  // ── กรณีจริง (PlaySound): 48 คาบ + รอยืนยันที่ผ่านแล้ว 3 คาบ · คาบละ 270 · ตัดยอดวันที่ 25 · วางข้อความจาก LINE ──
  await p.evaluate(() => {
    closeModal();
    S.places.push({ id: 9002, name: "PlaySound ทดสอบ", rate: 270, payMode: "session", active: true, note: "", cutoff: 25 });
    const mk = (id, date, att) => ({ id, date, time: "16:00", kind: "school", placeId: 9002, duration: 0.9, rate: 270, payMode: "session", heads: 1,
      attendance: att || "present", student: "นร" + (id % 7), topic: "", notes: "", scores: [], practiceItems: [], updatedAt: nowISO() });
    const days = []; for (let d = new Date("2026-09-26T00:00:00"); localISO(d) <= "2026-10-25"; d.setDate(d.getDate() + 1)) days.push(localISO(d));
    for (let i = 0; i < 48; i++) S.lessons.push(mk(9200 + i, days[i % 26]));
    S.lessons.push(mk(9300, "2026-09-29", "planned"), mk(9301, "2026-10-08", "planned"), mk(9302, "2026-10-21", "planned"));
    save(); openPayCut(9002, "2026-10");
  });
  sum = await p.evaluate(() => document.getElementById("pc-sum").textContent);
  ok(/ตามแอป.*48.*คาบ.*฿12,960/.test(sum) && /รอยืนยัน 3/.test(sum), "PlaySound: ตามแอป 48 คาบ ฿12,960 · รอยืนยัน 3");
  ok(await p.evaluate(() => document.getElementById("pc-paste-box").open), "ยังไม่ใส่ยอด → กล่องวางข้อความเปิดรอไว้");
  await p.fill("#pc-paste", "ขออนุญาตแจ้งยอดเงินเดือนตุลาคม  ค่ะ\n\nค่าสอน/ชั่วโมง = 270\n\n53  X 270 =  14310 บาท\nค่าคอมเทสเด็ก   200 บาท\n\n\n\nรวมเป็นเงิน 14510  บาทค่ะ\n\n\nขอบคุณค่ะ");
  const pv = await p.evaluate(() => document.getElementById("pc-parse").textContent.replace(/\s+/g, " "));
  ok(/53 คาบ × ฿270.*฿14,310/.test(pv) && /ค่าคอมเทสเด็ก.*\+฿200/.test(pv) && /รวม.*฿14,510/.test(pv) && !/⚠/.test(pv), "วางข้อความโรงเรียน → อ่านได้ 53 × ฿270 = ฿14,310 · ค่าคอมเทสเด็ก +฿200 · รวม ฿14,510 — " + pv.slice(0, 100));
  await p.click("#pc-parse-use");
  const r2 = await p.evaluate(() => S.settings.payCuts["9002|2026-10"]);
  ok(r2 && r2.reported === 14510 && r2.units === 53 && r2.rate === 270 && r2.extras.length === 1 && r2.extras[0].amount === 200, "ใช้ข้อมูลนี้ → ยอด 14,510 · นับ 53 · อัตรา 270 · รายการเพิ่ม 1");
  sum = await p.evaluate(() => document.getElementById("pc-sum").textContent.replace(/\s+/g, " "));
  ok(/ค่าคอมเทสเด็ก.*\+฿200/.test(sum) && /ได้รับจริง\s*฿13,160/.test(sum) && /มากกว่า ฿1,350/.test(sum), "รายการเพิ่มนับในได้รับจริง (฿13,160) · ส่วนต่างเหลือ ฿1,350 — " + sum.slice(0, 160));
  const why = await p.evaluate(() => (document.getElementById("pc-why") || {}).textContent || "");
  ok(/โรงเรียนนับ 53 คาบ · แอปนับ 48 คาบ/.test(why) && /ผ่านวันแล้ว 3 คาบ \(฿810\)/.test(why) && /ยังขาดอีก 2 คาบ \(≈ ฿540\)/.test(why),
    "อธิบายส่วนต่าง: นับ 53 vs 48 · รอยืนยันที่ผ่านแล้ว 3 (฿810) · ขาดอีก 2 (≈ ฿540) — " + why);
  if (process.env.SHOT_DIR) await p.locator("#pc-sum").screenshot({ path: path.join(process.env.SHOT_DIR, "paycut-playsound.png") });

  // ยืนยันทีละคาบ → เลิกทำ · ยืนยันทั้งหมด
  await p.click('#pc-list .pc-ok[data-id="9300"]');
  ok(await p.evaluate(() => S.lessons.find((l) => l.id === 9300).attendance === "present"), "✓ มาเรียน ทีละคาบ → เปลี่ยนเป็นมาเรียน");
  await p.click(".toast-act");
  ok(await p.evaluate(() => S.lessons.find((l) => l.id === 9300).attendance === "planned" && /รอยืนยัน 3/.test(document.getElementById("pc-sum").textContent)), "เลิกทำ → กลับเป็นรอยืนยัน");
  await p.click("#pc-due");
  sum = await p.evaluate(() => document.getElementById("pc-sum").textContent.replace(/\s+/g, " "));
  ok(/ตามแอป 51 คาบ.*฿13,770/.test(sum) && /มากกว่า ฿540/.test(sum) && /ยังขาดอีก 2 คาบ/.test(sum) && !/ผ่านวันแล้ว/.test(sum), "ยืนยันทั้ง 3 คาบ → ตามแอป 51 คาบ ฿13,770 · เหลือต่าง ฿540 (ขาด 2 คาบ)");
  await p.click("#pc-use");
  const r3 = await p.evaluate(() => S.settings.payCuts["9002|2026-10"]);
  sum = await p.evaluate(() => document.getElementById("pc-sum").textContent.replace(/\s+/g, " "));
  ok(r3.adj === 540 && /โรงเรียนนับ 53 คาบ \(แอป 51\)/.test(r3.note) && /✓ ตรงกัน/.test(sum) && /ได้รับจริง\s*฿14,510/.test(sum), "ใช้ยอดโรงเรียน → ปรับ +฿540 “โรงเรียนนับ 53 คาบ (แอป 51)” · ✓ ตรงกัน ฿14,510");
  await p.click(".pc-xdel");
  ok(await p.evaluate(() => !S.settings.payCuts["9002|2026-10"].extras), "ลบรายการเพิ่มได้ (✕)");

  ok(!errs.length, "ไม่มี error ในหน้า" + (errs.length ? ": " + errs.join(" | ") : ""));
  await browser.close(); server.close();
  console.log(fail.length ? "\n✗ ไม่ผ่าน " + fail.length + " ข้อ" : "\n✓ ผ่านทั้งหมด");
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
