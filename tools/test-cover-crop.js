#!/usr/bin/env node
/* ตรวจ "เลื่อน / ซูมรูปปกในรูปส่งผู้ปกครอง" (tools/lesson-layer/82-cover-crop.js) ด้วยเบราว์เซอร์จริง
 *
 *   npm i playwright && node tools/test-cover-crop.js
 *
 * รูปแนวตั้ง (หน้าแดงอยู่ช่วงบน ตัวสีน้ำเงิน) → การ์ดคาบที่ยังไม่ส่งตัดค่อนบน เห็นหน้า · การ์ดที่ส่งแล้วตัดกลางแบบเดิม
 * → แตะรูปในตัวอย่างเปิดหน้าปรับ → ลาก/ชิดบน/ซูม → ใช้ตำแหน่งนี้ → การ์ดทุกแบบใช้ตำแหน่งใหม่ และจำไว้กับคาบ
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
  ok(await p.evaluate(() => window.__coverCrop === "on"), "ชั้นเลื่อนรูปปกทำงาน");

  // รูปแนวตั้ง 900×1200: หน้า (แดง) แถว 160–290 · ตัว (น้ำเงิน) ที่เหลือ — ตัดกลางจะเห็นแถว ~296–903 (ไม่เห็นหน้า)
  await p.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 900; c.height = 1200;
    const x = c.getContext("2d");
    x.fillStyle = "#1E40FF"; x.fillRect(0, 0, 900, 1200);
    x.fillStyle = "#FF1010"; x.fillRect(250, 160, 400, 130);
    const url = c.toDataURL("image/png");
    const mk = (id, extra) => Object.assign({ id, date: todayStr(), time: "16:00", kind: "private", duration: 1, rate: 0, heads: 1, courseId: null,
      attendance: "present", student: "มายด์", topic: "Groove", notes: "", scores: [], practiceItems: [], updatedAt: nowISO(),
      media: { type: "image/png", name: "mind.png", size: 1000 } }, extra || {});
    S.lessons.unshift(mk(8101), mk(8102, { sentCard: { at: nowISO(), code: "X", preset: "x", w: 1, h: 1 } }));
    save(); window.__testUrl = url;
    return Promise.all([MDB.put(mediaKey(8101), url), MDB.put(mediaKey(8102), url)]);
  });
  // สีที่ตำแหน่งในกรอบรูป (fx, fy = สัดส่วนในกรอบ)
  const sample = (id, fx, fy) => p.evaluate(([id, fx, fy]) => buildReportCard(S.lessons.find((l) => l.id === id)).then((cv) => {
    const r = cv.__mediaRect; if (!r) return null;
    const k = cv.width / r.W, d = cv.getContext("2d").getImageData(Math.round((r.x + r.w * fx) * k), Math.round((r.y + r.h * fy) * k), 1, 1).data;
    return d[0] > 180 && d[2] < 90 ? "red" : d[2] > 180 && d[0] < 90 ? "blue" : "other:" + d.join(",");
  }), [id, fx, fy]);

  ok(await sample(8101, 0.5, 0.15) === "red", "คาบที่ยังไม่ส่ง: ตัดค่อนบน เห็นหน้า (ไม่คอขาด)");
  ok(await sample(8102, 0.5, 0.15) === "blue", "คาบที่ส่งการ์ดไปแล้ว: ตัดกลางแบบเดิม (รหัสตรวจไม่เพี้ยน)");

  await p.evaluate(() => openReportCard(8101));
  await p.waitForSelector("#cc-hit", { timeout: 10000 }).catch(() => {});
  ok(await p.evaluate(() => !!document.getElementById("cc-hit") && /แตะเพื่อเลื่อนรูป/.test(document.getElementById("cc-hit").textContent)),
    "ตัวอย่างการ์ดมีจุดแตะ “✥ แตะเพื่อเลื่อนรูป” ทับกรอบรูป");
  ok(await p.evaluate(() => !!document.getElementById("cc-btn")), "ปุ่ม “✥ เลื่อน / ซูมรูปปก” ในแผงส่ง");
  const hit = await p.evaluate(() => {
    const a = document.getElementById("cc-hit").getBoundingClientRect(), img = document.querySelector("#rc-preview img").getBoundingClientRect();
    return { top: (a.top - img.top) / img.height, h: a.height / img.height, w: a.width / img.width };
  });
  ok(hit.top > 0.05 && hit.top < 0.8 && hit.w > 0.8 && hit.h > 0.1, "จุดแตะอยู่ตรงกรอบรูปในการ์ด (บน " + hit.top.toFixed(2) + " · กว้าง " + hit.w.toFixed(2) + ")");

  if (process.env.SHOT_DIR) await p.screenshot({ path: path.join(process.env.SHOT_DIR, "crop-preview.png") });
  await p.click("#cc-hit");
  await p.waitForSelector("#cc-sheet", { timeout: 5000 }).catch(() => {});
  ok(await p.evaluate(() => !!document.getElementById("cc-sheet")), "แตะรูปแล้วเปิดหน้าเลื่อน / ซูม");

  // ลากรูปลง 400px = เลื่อนไปเห็นด้านบนสุด
  const fr = await p.locator("#cc-frame").boundingBox();
  await p.mouse.move(fr.x + fr.width / 2, fr.y + 20);
  await p.mouse.down();
  for (let i = 1; i <= 8; i++) await p.mouse.move(fr.x + fr.width / 2, fr.y + 20 + i * 50);
  await p.mouse.up();
  const top = await p.evaluate(() => { const c = document.getElementById("cc-cv"), d = c.getContext("2d").getImageData(c.width / 2, Math.round(c.height * 0.4), 1, 1).data; return d[0] > 180 && d[2] < 90; });
  ok(top, "ลากรูปลงแล้วตัวอย่างในหน้าปรับเลื่อนตาม (เห็นหน้าช่วงบน)");
  if (process.env.SHOT_DIR) await p.screenshot({ path: path.join(process.env.SHOT_DIR, "crop-editor.png") });
  await p.click("#cc-ok");
  await p.waitForFunction(() => !document.getElementById("cc-sheet"), null, { timeout: 3000 }).catch(() => {});
  const c1 = await p.evaluate(() => S.lessons.find((l) => l.id === 8101).media.crop);
  ok(c1 && c1.y === 0 && c1.z === 1, "ใช้ตำแหน่งนี้ → จำไว้กับคาบ (y " + (c1 && c1.y) + ")");
  ok(await p.evaluate(() => JSON.parse(localStorage.getItem("td_lessons")).find((l) => l.id === 8101).media.crop.y === 0), "บันทึกลงเครื่องแล้ว (ซิงค์ไปกับคาบ)");
  ok(await sample(8101, 0.5, 0.45) === "red", "การ์ดใหม่ใช้ตำแหน่งที่เลื่อน (หน้าอยู่กลางกรอบ)");
  await p.waitForSelector("#cc-hit", { timeout: 10000 }).catch(() => {});

  // ซูม 200% + ชิดล่าง
  await p.click("#cc-btn");
  await p.waitForSelector("#cc-sheet", { timeout: 5000 });
  await p.evaluate(() => { const z = document.getElementById("cc-zoom"); z.value = 200; z.dispatchEvent(new Event("input")); });
  await p.click("#cc-down");
  await p.click("#cc-ok");
  const c2 = await p.evaluate(() => S.lessons.find((l) => l.id === 8101).media.crop);
  ok(c2 && c2.z === 2 && c2.y === 1, "ซูม 200% + ⤓ ชิดล่าง → z 2 · y 1");
  ok(await sample(8101, 0.5, 0.15) === "blue", "การ์ดซูมแล้ว ไม่เห็นหน้า (ส่วนล่างของรูป)");

  // ยกเลิก = ไม่เปลี่ยน
  await p.waitForSelector("#cc-btn", { timeout: 10000 });
  await p.click("#cc-btn");
  await p.waitForSelector("#cc-sheet", { timeout: 5000 });
  await p.click("#cc-up");
  await p.click("#cc-x");
  ok(await p.evaluate(() => S.lessons.find((l) => l.id === 8101).media.crop.y === 1), "ยกเลิก → ตำแหน่งเดิม");

  // คาบที่ปิดรูปในการ์ด: ไม่มีจุดแตะ
  await p.evaluate(() => { closeModal(); const l = S.lessons.find((x) => x.id === 8101); delete l.media; delete THUMB[8101]; save();
    return MDB.del(mediaKey(8101)).then(() => openReportCard(8101)); });
  await p.waitForSelector("#rc-actions button", { timeout: 10000 });
  ok(await p.evaluate(() => !document.getElementById("cc-hit") && !document.getElementById("cc-btn")), "คาบที่ไม่มีรูป: ไม่มีปุ่มเลื่อนรูป");

  ok(!errs.length, "ไม่มี error ในหน้า" + (errs.length ? ": " + errs.join(" | ") : ""));
  await browser.close(); server.close();
  console.log(fail.length ? "\n✗ ไม่ผ่าน " + fail.length + " ข้อ" : "\n✓ ผ่านทั้งหมด");
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
