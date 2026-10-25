#!/usr/bin/env node
/* ตรวจระบบบันทึกงานของกลอง → MIDI (จุดบันทึกย้ายจาก localStorage ไป IndexedDB)
 *
 *   npm i playwright && node tools/test-storage.js
 *
 * 1. เปิดรุ่นก่อนหน้า (git HEAD~ ที่ยังเก็บใน localStorage) นำเข้า MIDI แล้วกดบันทึก
 * 2. สลับเป็นรุ่นปัจจุบันแล้วรีเฟรช — จุดบันทึกเก่าต้องย้ายเข้า IndexedDB และเปิดกลับได้ครบ
 * 3. เพลงยาว 300 ห้อง (~7,200 โน้ต) บันทึก 8 ครั้งต้องไม่ขึ้น "ที่เก็บเต็ม"
 *    และร่างกันงานหายต้องยังเขียนได้ (รุ่นเก่าเต็มตั้งแต่ครั้งที่ 6 แล้วร่างหยุดเขียนเงียบ ๆ)
 * 4. ลบจุดบันทึกแล้วต้องหายจาก IndexedDB ด้วย
 *
 * รุ่นก่อนหน้าดึงด้วย `git show <ref>:index.html` (ตั้ง OLD_REF ได้ ค่าเริ่มต้น HEAD)
 * ถ้ารุ่นนั้นใช้ IndexedDB อยู่แล้ว ขั้นที่ 2 จะไม่มีอะไรให้ย้าย ชุดทดสอบจะบอกแล้วข้ามไป
 * ออก 0 = ผ่าน, 1 = ไม่ผ่าน
 */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path"), cp = require("child_process");
const { chromium } = require("playwright");

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

let OLD = null;
try { OLD = cp.execSync(`git show ${process.env.OLD_REF || "HEAD"}:index.html`, { cwd: ROOT, maxBuffer: 1 << 26 }).toString(); } catch (_) {}
const NEW = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
let serveOld = false;

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split("?")[0]);
  if (!rel.startsWith(PREFIX)) { res.writeHead(404); return res.end(); }
  rel = rel.slice(PREFIX.length); if (rel === "" || rel.endsWith("/")) rel += "index.html";
  if (rel === "index.html") { res.writeHead(200, { "Content-Type": MIME[".html"] }); return res.end(serveOld && OLD ? OLD : NEW); }
  const f = path.join(ROOT, rel);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});

/* MIDI กลองหนาแน่น: ไฮแฮตเขบ็ตสองชั้น กระเดื่อง สแนร์ ฟิลทุก 8 ห้อง */
function makeMidi(bars) {
  const TPQ = 480, ev = [];
  const note = (t, n, v) => { ev.push([t, 0x99, n, v]); ev.push([t + 60, 0x89, n, 0]); };
  for (let bar = 0; bar < bars; bar++) {
    const b0 = bar * 4 * TPQ;
    for (let s = 0; s < 16; s++) {
      const t = b0 + s * TPQ / 4;
      if (bar % 8 === 7 && s >= 8) { note(t, [38, 48, 47, 43][(s - 8) >> 1], 100); continue; }
      note(t, s === 14 ? 46 : 42, s % 2 ? 70 : 100);
    }
    [0, 6, 8, 10].forEach((s) => note(b0 + s * TPQ / 4, 36, 110));
    [4, 12].forEach((s) => note(b0 + s * TPQ / 4, 38, 115));
    if (bar % 8 === 0) note(b0, 49, 120);
  }
  ev.sort((a, b) => a[0] - b[0]);
  const vlq = (n) => { const o = [n & 0x7f]; n >>= 7; while (n) { o.unshift((n & 0x7f) | 0x80); n >>= 7; } return o; };
  const trk = [0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20, 0, 0xff, 0x58, 4, 4, 2, 24, 8];
  let last = 0;
  for (const [t, st, n, v] of ev) { trk.push(...vlq(t - last), st, n, v); last = t; }
  trk.push(0, 0xff, 0x2f, 0);
  const u32 = (n) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  return Buffer.from([0x4d, 0x54, 0x68, 0x64, ...u32(6), 0, 0, 0, 1, TPQ >> 8, TPQ & 255, 0x4d, 0x54, 0x72, 0x6b, ...u32(trk.length), ...trk]);
}

const lsBlobs = (p) => p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("klongpro.blob.")));
const idbKeys = (p) => p.evaluate(() => new Promise((res) => {
  const rq = indexedDB.open("klongpro-snaps", 1);
  rq.onupgradeneeded = () => rq.result.createObjectStore("blob");
  rq.onsuccess = () => { const db = rq.result; const g = db.transaction("blob").objectStore("blob").getAllKeys();
    g.onsuccess = () => { res(g.result); db.close(); }; g.onerror = () => { res([]); db.close(); }; };
  rq.onerror = () => res([]);
}));
const stat = (p) => p.evaluate(() => { const m = /ตัวโน้ตรวม <b>(\d+)/.exec(document.querySelector("#stats").innerHTML); return m ? +m[1] : 0; });
const status = (p) => p.evaluate(() => document.querySelector("#status").textContent);

async function importMidi(p, buf, name) {
  await p.setInputFiles("#impMid", { name, mimeType: "audio/midi", buffer: buf });
  await p.waitForFunction(() => /นำเข้า/.test(document.querySelector("#status").textContent), null, { timeout: 60000 });
}
const saveNow = (p) => p.evaluate(() => document.querySelector("#sNow").click());
async function waitSaved(p) {
  await p.waitForFunction(() => /บันทึกแล้ว|เต็ม|ไม่สำเร็จ/.test(document.querySelector("#status").textContent), null, { timeout: 30000 }).catch(() => {});
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const BASE = `http://127.0.0.1:${server.address().port}${PREFIX}`;
  const browser = await chromium.launch({ executablePath: chromiumPath() });
  const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("dialog", (d) => d.accept().catch(() => {}));   // "นำเข้าจะแทนที่งานที่เปิดอยู่" ตอบตกลง
  const small = makeMidi(24), big = makeMidi(300);

  console.log("1) รุ่นก่อนหน้าบันทึกงานไว้");
  serveOld = true;
  await p.goto(BASE);
  await p.waitForSelector("#homeBlank", { state: "visible" });
  await p.click("#homeBlank"); await p.waitForTimeout(300);
  await importMidi(p, small, "เก่า.mid");
  const nOld = await stat(p);
  await saveNow(p); await waitSaved(p);
  const before = await lsBlobs(p);
  const legacy = before.length > 0;
  ok(nOld > 0, `นำเข้าแล้ว ${nOld} ตัวโน้ต`);
  console.log(legacy ? `  · รุ่นเก่าเก็บใน localStorage ${before.length} จุด` : "  · รุ่นเก่าไม่ได้เก็บใน localStorage (ไม่มีอะไรให้ย้าย)");

  console.log("2) รุ่นปัจจุบัน: ย้ายจุดบันทึกเก่าเข้า IndexedDB แล้วเปิดกลับ");
  serveOld = false;
  await p.goto(BASE);
  await p.waitForSelector("#homeBlank", { state: "visible" });
  await p.waitForTimeout(2500);
  if (legacy) {
    ok((await lsBlobs(p)).length === 0, "localStorage ไม่เหลือตัวจุดบันทึก");
    ok((await idbKeys(p)).length >= before.length, "จุดบันทึกเก่าอยู่ใน IndexedDB ครบ");
  }
  const row = p.locator("#homeRecent button[data-open]").first();
  ok(await row.count() > 0, "หน้าแรกแสดงงานล่าสุด");
  if (await row.count()) {
    await row.click();
    await p.waitForFunction(() => /ตัวโน้ตรวม <b>\d+/.test(document.querySelector("#stats").innerHTML), null, { timeout: 10000 }).catch(() => {});
    ok(await stat(p) === nOld, `เปิดจุดบันทึกเก่าได้ ${await stat(p)} ตัวโน้ต (ต้องเท่ากับ ${nOld})`);
  }

  console.log("3) เพลง 300 ห้อง บันทึก 8 ครั้ง");
  await importMidi(p, big, "ยาว.mid");
  const nBig = await stat(p);
  ok(nBig > 6000, `นำเข้าแล้ว ${nBig} ตัวโน้ต`);
  let full = 0;
  for (let k = 0; k < 8; k++) {
    await p.evaluate(() => { document.querySelector("#status").textContent = ""; });
    await saveNow(p); await waitSaved(p);
    if (/เต็ม|ไม่สำเร็จ/.test(await status(p))) full++;
  }
  ok(full === 0, `บันทึกครบ 8 ครั้ง ไม่ขึ้นที่เก็บเต็ม (เต็ม ${full} ครั้ง)`);
  const lsChars = await p.evaluate(() => Object.keys(localStorage).reduce((n, k) => n + k.length + localStorage.getItem(k).length, 0));
  ok(lsChars < 300000, `localStorage ใช้แค่ ${Math.round(lsChars / 1024)}K ตัวอักษร (ยังเหลือที่ให้ร่างกันงานหาย)`);

  // แก้หนึ่งครั้ง แล้วรอร่างกันงานหาย (เขียนหลังหยุดมือ 3 วินาที)
  const t0 = Date.now();
  await importMidi(p, small, "แก้.mid");
  await p.waitForTimeout(4000);
  const draftAt = await p.evaluate(() => { try { return JSON.parse(localStorage.getItem("klongpro.draft")).at; } catch (e) { return 0; } });
  ok(draftAt >= t0, "ร่างกันงานหายเขียนลงได้หลังบันทึกเพลงยาวหลายครั้ง");

  console.log("4) ลบจุดบันทึก");
  const keysBefore = await idbKeys(p);
  const delId = await p.evaluate(() => { const m = JSON.parse(localStorage.getItem("klongpro.meta")); return m.items[0].id; });
  await p.evaluate((id) => window.KP.del(id), delId);
  await p.waitForTimeout(300);
  const keysAfter = await idbKeys(p);
  ok(keysBefore.includes(delId) && !keysAfter.includes(delId), "ลบแล้วหายจาก IndexedDB");

  ok(errs.length === 0, "ไม่มี error ในหน้า" + (errs.length ? ": " + errs.slice(0, 3).join(" | ") : ""));
  await browser.close(); server.close();
  console.log("\n" + (fail.length ? "ไม่ผ่าน " + fail.length + " ข้อ" : "ผ่านทั้งหมด"));
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
