#!/usr/bin/env node
/* ตรวจ "รูปส่งผู้ปกครองตามเทศกาล / ฤดู" (tools/lesson-layer/59-fest-cards.js) ด้วยเบราว์เซอร์จริง
 *
 *   npm i playwright && node tools/test-fest-cards.js
 *
 * ธีมตามวันที่ของคาบ (เทศกาล + ฤดู) → เลือกอัตโนมัติตามโหมด · รายคนยังใช้ได้ (ฤดูไม่แทน) · ทางการคงเดิม · ส่งแล้วคงเดิม
 * → สีอ่านออกทุกธีม → รูปเหมือนเดิมทุกครั้ง (รหัสตรวจคงที่) → แกลเลอรีมีธีมช่วงนั้นเป็นรูปแรก → แถวตั้งค่าสลับโหมด
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
  ok(await p.evaluate(() => window.__festCards === "on"), "ชั้นการ์ดตามเทศกาลทำงาน");

  const th = await p.evaluate(() => ({ hw: __festCardThemes("2026-10-28"), jul: __festCardThemes("2026-07-01"), apr: __festCardThemes("2026-04-14"),
    xmas: __festCardThemes("2026-12-24"), feb: __festCardThemes("2026-03-01") }));
  ok(th.hw.join() === "t-halloween,t-season-cool", "28 ต.ค. → 🎃 ฮาโลวีน + ❄️ หน้าหนาว");
  ok(th.jul.join() === "t-season-rainy", "1 ก.ค. → 🌧️ หน้าฝน (ไม่มีเทศกาล)");
  ok(th.apr.join() === "t-songkran,t-season-summer", "14 เม.ย. → 💦 สงกรานต์ + ☀️ หน้าร้อน · ปิดเทอม");
  ok(th.xmas[0] === "t-christmas" && th.feb.join() === "t-season-summer", "24 ธ.ค. → 🎄 คริสต์มาส · 1 มี.ค. → หน้าร้อน");

  await p.evaluate(() => {
    const mk = (id, date, student, extra) => Object.assign({ id, date, time: "16:00", kind: "private", duration: 1, rate: 0, heads: 1, courseId: null,
      attendance: "present", student, topic: "Groove", notes: "ตีได้ดีขึ้น", scores: [], practiceItems: [], updatedAt: nowISO() }, extra || {});
    S.lessons.unshift(mk(8201, "2026-10-28", "ภูมิ"), mk(8202, "2026-07-01", "ภูมิ"), mk(8203, "2026-07-01", "ใบเตย"), mk(8204, "2026-10-28", "ใบเตย"),
      mk(8205, "2026-10-28", "ภูมิ", { sentCard: { at: nowISO(), code: "X", preset: "b-classic", w: 1, h: 1 } }));
    exportRules().students["ใบเตย"] = "b-cute"; save();
  });
  const res = (id) => p.evaluate((id) => { const r = resolvePreset(S.lessons.find((l) => l.id === id)); return r.id + "|" + r.src; }, id);
  ok(await res(8201) === "t-halloween|festival", "อัตโนมัติ: คาบช่วงฮาโลวีน → ธีมฮาโลวีน");
  ok(await res(8202) === "t-season-rainy|season", "อัตโนมัติ: คาบปกติ (ค่าเริ่มต้น) → ธีมฤดู");
  ok(await res(8203) === "b-cute|student", "ตั้งรายคนไว้ (ใบเตย = สดใสน่ารัก) → ฤดูไม่แทน");
  ok(await res(8204) === "t-halloween|festival", "ช่วงเทศกาล → เทศกาลแทนแม้ตั้งรายคน");
  ok(await res(8205) === "b-classic|default", "คาบที่ส่งการ์ดไปแล้ว → หน้าตาเดิม");
  await p.evaluate(() => { S.settings.festCards = "fest"; });
  ok(await res(8202) === "b-classic|default" && await res(8201) === "t-halloween|festival", "โหมดเฉพาะเทศกาล: คาบปกติใช้ค่าเริ่มต้น · ฮาโลวีนยังเปลี่ยน");
  await p.evaluate(() => { S.settings.festCards = "off"; });
  ok(await res(8201) === "b-classic|default", "โหมดปิด: ไม่เปลี่ยนเอง");
  await p.evaluate(() => { S.settings.festCards = "all"; exportRules().def = "b-formal"; });
  ok(await res(8201) === "b-formal|default", "ค่าเริ่มต้นแบบทางการ → คงทางการ (ไม่ใส่ธีม)");
  await p.evaluate(() => { exportRules().def = "b-classic"; save(); });

  // สีอ่านออกทุกธีม (เกณฑ์เดียวกับตัวเตือนในแอป)
  const bad = await p.evaluate(() => Object.keys(FEST_THEMES).filter((k) => k !== "custom").concat(["season-summer", "season-rainy", "season-cool"]).filter((k) => {
    const st = styleOfPreset("t-" + k);
    return !(contrast(st.text, st.bg) >= 4.5 && contrast(st.body, st.bg) >= 4.5 && contrast(st.accent, st.bg) >= 3 && contrast(st.onAccent, st.accent) >= 4.5);
  }));
  ok(!bad.length, "ทุกธีมอ่านออก: ตัวหนังสือ ≥ 4.5 · สีหลัก ≥ 3 · ตัวอักษรบนสีหลัก ≥ 4.5" + (bad.length ? " — ไม่ผ่าน: " + bad.join(",") : ""));

  // รูปเหมือนเดิมทุกครั้ง (ลวดลายสุ่มแบบคงที่)
  const codes = await p.evaluate(async () => { const l = S.lessons.find((x) => x.id === 8201), st = styleOfPreset("t-halloween");
    const a = await renderCardFile(l, st), b = await renderCardFile(l, st); return [a.code, b.code]; });
  ok(codes[0] && codes[0] === codes[1], "สร้างรูปธีมสองครั้ง รหัสตรวจเท่ากัน (" + codes[0] + ")");

  await p.evaluate(() => openReportCard(8201));
  await p.waitForFunction(() => RC && RC.cache && RC.cache["t-halloween"], null, { timeout: 15000 }).catch(() => {});
  const g = await p.evaluate(() => ({ first: Array.from(document.querySelectorAll("#rc-presets .rcname")).slice(0, 2).map((x) => x.textContent),
    src: document.getElementById("rc-src").textContent, on: RC.presetId }));
  ok(g.first[0] === "🎃 ฮาโลวีน" && g.first[1] === "❄️ หน้าหนาว", "แกลเลอรี: ธีมช่วงนั้นเป็นรูปแรก ๆ (" + g.first.join(", ") + ")");
  ok(g.on === "t-halloween" && /อัตโนมัติ: 🎃 ฮาโลวีน \(ช่วงเทศกาล/.test(g.src), "เปิดมาเลือกธีมฮาโลวีนให้เอง — " + g.src);
  if (process.env.SHOT_DIR) { await p.waitForTimeout(400); await p.locator("#rc-preview").screenshot({ path: path.join(process.env.SHOT_DIR, "fest-card.png") }); }
  await p.evaluate(() => rcPickPreset("b-classic"));
  ok(await p.evaluate(() => RC.presetId) === "b-classic", "เลือกแบบอื่นแทนได้");

  await p.evaluate(() => { closeModal(); openMenu(); });
  ok(await p.evaluate(() => /การ์ดตามเทศกาล \/ ฤดู/.test((document.getElementById("festcard-row") || {}).textContent || "")), "⚙ มีแถว “การ์ดตามเทศกาล / ฤดู”");
  ok(await p.evaluate(() => { const r = document.getElementById("festcard-row"), g = r.closest(".mt-sec, details, [data-group]"); return !!r.closest(".mt") && /ส่งผู้ปกครอง/.test((r.closest(".mt-body, .mt-sec, details") || r.parentNode).parentNode.textContent); }),
    "อยู่ในหมวด ส่งผู้ปกครองและหน้าตา");
  await p.evaluate(() => document.getElementById("festcard-row").click());
  ok(await p.evaluate(() => S.settings.festCards === "fest" && /เฉพาะช่วงเทศกาล/.test(document.getElementById("festcard-row").textContent)), "แตะ → เฉพาะเทศกาล");
  await p.evaluate(() => { document.getElementById("festcard-row").click(); document.getElementById("festcard-row").click(); });
  ok(await p.evaluate(() => S.settings.festCards === "all" && JSON.parse(localStorage.getItem("td_settings")).festCards === "all"), "แตะวน → กลับเป็นเทศกาล + ฤดู · บันทึกแล้ว");

  ok(!errs.length, "ไม่มี error ในหน้า" + (errs.length ? ": " + errs.join(" | ") : ""));
  await browser.close(); server.close();
  console.log(fail.length ? "\n✗ ไม่ผ่าน " + fail.length + " ข้อ" : "\n✓ ผ่านทั้งหมด");
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
