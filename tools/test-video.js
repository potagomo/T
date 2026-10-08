#!/usr/bin/env node
/* ตรวจ "แนบคลิปวิดีโอให้คาบ" ของครูต้า (tools/lesson-layer/80-video.js) ด้วยเบราว์เซอร์จริง
 *
 *   npm i playwright && node tools/test-video.js        (ต้องมี ffmpeg ไว้สร้างคลิปทดสอบ)
 *
 * แนบคลิป → หน้าปกจากเฟรมจริง + ความยาว → บันทึก (ไฟล์อยู่ในเครื่อง ไม่ซิงค์) → เล่นในแอป
 * → การ์ดรายงานมีปุ่มส่งคลิป → แชร์ได้ตัวไฟล์ · คลิปเกิน 10 นาทีไม่รับ · เปลี่ยนเป็นรูปแล้วลบไฟล์คลิป
 * ออก 0 = ผ่าน, 1 = ไม่ผ่าน
 */
"use strict";
const http = require("http"), fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
const { chromium, devices } = require("playwright");

const ROOT = path.resolve(__dirname, ".."), PREFIX = "/T/";
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".woff2": "font/woff2" };
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

// Chromium ของ Playwright ไม่มี H.264 จึงทดสอบด้วย WebM (VP8) — โค้ดในแอปไม่ผูกกับชนิดไฟล์
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "kruta-vid-"));
function makeClips() {
  const ff = (args) => cp.execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args], { stdio: "inherit" });
  // สัญญาณรบกวนทำให้ไฟล์ใหญ่จริง (~3 MB) ไว้ทดสอบการย่อ
  ff(["-f", "lavfi", "-i", "testsrc=size=640x360:rate=25", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "8", "-vf", "noise=alls=30:allf=t",
      "-c:v", "libvpx", "-b:v", "3M", "-minrate", "3M", "-maxrate", "3M", "-c:a", "libvorbis", "-shortest", path.join(TMP, "lesson.webm")]);
  ff(["-f", "lavfi", "-i", "testsrc=size=64x36:rate=2", "-t", "660", "-c:v", "libvpx", "-b:v", "20k", path.join(TMP, "long.webm")]);
}
const toastText = (p) => p.evaluate(() => Array.from(document.querySelectorAll(".toast")).map((t) => t.textContent).join(" | "));

(async () => {
  try { makeClips(); } catch (e) { console.log("ต้องมี ffmpeg เพื่อสร้างคลิปทดสอบ"); process.exit(1); }
  await new Promise((r) => server.listen(0, r));
  const URL_ = "http://localhost:" + server.address().port + PREFIX + "lesson/";
  const browser = await chromium.launch({ executablePath: chromiumPath() });
  const ctx = await browser.newContext({ ...devices["Galaxy S9+"], serviceWorkers: "block" });
  // Chromium ของ Playwright ไม่มี H.264 → ใช้ VP9 ทดสอบท่อย่อคลิปเดียวกัน (มือถือ/iPad จริงใช้ H.264)
  await ctx.addInitScript(() => { window.__videoCodecs = ["vp9"]; });
  const p = await ctx.newPage(); const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(URL_);
  await p.evaluate(() => { lsSet("td_pw", hashPw("1234")); document.getElementById("pw-input").value = "1234"; doLogin(); });
  await p.waitForFunction(() => document.getElementById("app").style.display === "block", null, { timeout: 10000 });
  ok(await p.evaluate(() => window.__video === "on"), "ชั้นคลิปวิดีโอทำงาน");

  await p.evaluate(() => {
    S.lessons.unshift({ id: 7001, date: todayStr(), time: "16:00", kind: "private", duration: 1, rate: 0, heads: 1, courseId: null,
      attendance: "present", student: "น้องคลิป", topic: "Groove", notes: "", scores: [], practiceItems: [], updatedAt: nowISO() });
    save(); renderAll(); openEdit(7001);
  });
  ok(await p.evaluate(() => /video/.test(document.getElementById("media-inp").accept) && /คลิปวิดีโอ/.test(document.getElementById("media-block").textContent)),
    "ช่องแนบรับวิดีโอ: “แนบรูป / GIF / คลิปวิดีโอ”");

  const clip = path.join(TMP, "lesson.webm"), size = fs.statSync(clip).size;
  await p.setInputFiles("#media-inp", clip);
  await p.waitForFunction(() => EF.media && EF.media.video, null, { timeout: 15000 }).catch(() => {});
  const m = await p.evaluate(() => EF.media);
  ok(m && m.video && Math.abs(m.dur - 8) <= 1 && m.size > 0, "แนบคลิปแล้ว: รู้ความยาว " + (m && m.dur) + " วินาที");
  ok(await p.evaluate(() => /🎬 คลิป 0:0[78]/.test(document.getElementById("media-block").textContent)), "กล่องในฟอร์มโชว์ 🎬 ความยาว + ขนาดไฟล์ + ปุ่ม ▶ ดู");
  if (process.env.SHOT_DIR) { await p.locator("#media-block").scrollIntoViewIfNeeded(); await p.screenshot({ path: path.join(process.env.SHOT_DIR, "video-form.png") }); }
  const poster = await p.evaluate(async () => {
    const src = PEND.puts["media:7001"]; if (!/^data:image\/jpeg/.test(src || "")) return null;
    const im = new Image(); im.src = src; await im.decode();
    const c = document.createElement("canvas"); c.width = im.width; c.height = im.height; const x = c.getContext("2d"); x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, im.width, Math.round(im.height * 0.3)).data; const seen = new Set();
    for (let i = 0; i < d.length; i += 400) seen.add((d[i] >> 5) + "," + (d[i + 1] >> 5) + "," + (d[i + 2] >> 5));
    return { w: im.width, colors: seen.size };
  });
  ok(poster && poster.colors > 6, "หน้าปกเป็นเฟรมจริงจากคลิป (" + (poster && poster.colors) + " สี) ไม่ใช่จอดำ");
  // ภาพที่ไปการ์ดรายงาน (media:) ต้องไม่มีปุ่ม ▶ — มีเฉพาะภาพย่อในแอป (thumb:)
  const badge = await p.evaluate(async () => {
    const at = async (src, fx, fy) => { const im = new Image(); im.src = src; await im.decode();
      const c = document.createElement("canvas"); c.width = im.width; c.height = im.height; const x = c.getContext("2d"); x.drawImage(im, 0, 0);
      const r = Math.min(im.width, im.height) * 0.13, d = x.getImageData(Math.round(im.width / 2 + fx * r), Math.round(im.height / 2 + fy * r), 1, 1).data;
      return d[0] + d[1] + d[2]; };
    const tri = [[0.05, 0], [0.1, 0.05], [0.1, -0.05]];
    const white = async (src) => { let n = 0; for (const [a, b] of tri) if (await at(src, a, b) > 720) n++; return n; };
    return { poster: await white(PEND.puts["media:7001"]), thumb: await white(PEND.puts["thumb:7001"]) };
  });
  ok(badge.thumb === 3 && badge.poster < 3, "ภาพย่อในแอปมีปุ่ม ▶ · ภาพที่ส่งผู้ปกครองไม่มีปุ่ม ▶ ปลอม");

  await p.evaluate(() => saveLesson());
  await p.waitForFunction(() => !document.getElementById("media-block"), null, { timeout: 15000 }).catch(() => {});
  const stored = await p.evaluate(async () => {
    const b = await MDB.get("vid:7001"), l = S.lessons.find((x) => x.id === 7001);
    return { blob: b instanceof Blob, size: b && b.size, video: l && l.media && l.media.video, thumb: !!THUMB[7001],
      synced: SYNC_FILE_PREFIX.some((pre) => "vid:7001".indexOf(pre) === 0), inLesson: JSON.stringify(l).length < 2000 };
  });
  ok(stored.blob && stored.size === size, "บันทึกแล้ว: ตัวคลิปเก็บในเครื่อง (" + stored.size + " ไบต์ ตรงกับไฟล์)");
  ok(stored.video && stored.thumb && stored.inLesson, "ข้อมูลคาบเก็บแค่รายละเอียดคลิป ไม่ยัดไฟล์ลงข้อมูลที่ซิงค์");
  ok(!stored.synced, "คลิปวิดีโอไม่ขึ้นซิงค์ (กันโควตา Firestore ฟรีเต็ม)");

  await p.evaluate(() => playLessonVideo(7001));
  await p.waitForFunction(() => { const v = document.querySelector("#vid-player video"); return v && v.readyState >= 1; }, null, { timeout: 10000 }).catch(() => {});
  ok(await p.evaluate(() => { const v = document.querySelector("#vid-player video"); return !!v && Math.abs(v.duration - 8) < 1; }), "กด ▶ เล่นคลิปในแอปได้");
  await p.click("#vid-player button");
  ok(await p.evaluate(() => !document.getElementById("vid-player")), "ปิดตัวเล่นได้");

  // การ์ดคาบ: แตะรูปหน้าปกแล้วเล่น
  const tapped = await p.evaluate(async () => {
    const img = Array.from(document.querySelectorAll("img")).find((i) => i.getAttribute("src") === THUMB[7001]);
    if (!img) return "no-img";
    img.click(); await new Promise((r) => setTimeout(r, 300));
    const on = !!document.getElementById("vid-player"); const b = document.querySelector("#vid-player button"); if (b) b.click();
    return on;
  });
  if (tapped !== "no-img") ok(tapped === true, "แตะหน้าปกในการ์ดคาบแล้วเล่นคลิป");

  // ส่งผู้ปกครอง: ปุ่มส่งคลิปอยู่ต่อจากปุ่มส่งรูป และแชร์เป็นตัวไฟล์
  await p.evaluate(() => {
    window.__shared = null;
    navigator.canShare = (d) => !!(d && d.files && d.files.length);
    navigator.share = (d) => { window.__shared = d; return Promise.resolve(); };
    openReportCard(7001);
  });
  await p.waitForFunction(() => /ส่งคลิปวิดีโอ/.test((document.getElementById("rc-actions") || {}).textContent || ""), null, { timeout: 15000 }).catch(() => {});
  const order = await p.evaluate(() => Array.from(document.querySelectorAll("#rc-actions button")).map((b) => b.textContent.trim()));
  ok(order.length > 1 && /ส่งคลิปวิดีโอ 0:0[78]/.test(order[1]) && /แชร์รูป/.test(order[0]), "การ์ดรายงาน: ส่งรูป แล้วตามด้วย “🎬 ส่งคลิปวิดีโอ” (" + order.slice(0, 2).join(" / ") + ")");
  if (process.env.SHOT_DIR) { await p.waitForTimeout(800); await p.locator("#rc-actions").scrollIntoViewIfNeeded(); await p.screenshot({ path: path.join(process.env.SHOT_DIR, "video-rc.png") }); }
  await p.locator("#rc-actions button", { hasText: "ส่งคลิปวิดีโอ" }).click();
  await p.waitForFunction(() => window.__shared, null, { timeout: 5000 }).catch(() => {});
  const sh = await p.evaluate(() => { const f = window.__shared && window.__shared.files && window.__shared.files[0]; return f ? { name: f.name, type: f.type, size: f.size } : null; });
  ok(sh && sh.size === size && /^video\//.test(sh.type) && /น้องคลิป.*\.webm$/.test(sh.name), "แชร์ได้ตัวไฟล์คลิป (" + (sh && sh.name) + ") — LINE กดเล่นในแชตได้เลย");
  await p.evaluate(() => closeModal());

  // อีกเครื่องที่ไม่มีไฟล์ (คลิปไม่ซิงค์): บอกตรง ๆ ว่าอยู่เครื่องไหน
  const blobBack = await p.evaluate(async () => { const b = await MDB.get("vid:7001"); await MDB.del("vid:7001"); window.__keep = b; shareClip(7001); return true; });
  await p.waitForTimeout(300);
  ok(/ไม่ซิงค์/.test(await toastText(p)), "เครื่องที่ไม่มีไฟล์คลิป: บอกว่าคลิปอยู่ในเครื่องที่แนบ");
  await p.evaluate(async () => { await MDB.put("vid:7001", window.__keep); });

  // คลิปใหญ่เกินที่ Chrome แชร์ได้ (50 MB) — ลดเพดานลงเพื่อทดสอบด้วยไฟล์ 3 MB
  await p.evaluate(() => { window.__videoLimits = { share: 1024 * 1024, target: 400 * 1024, minBps: 150000 }; window.__shared = null; openReportCard(7001); });
  await p.waitForFunction(() => /ส่งคลิปวิดีโอ/.test((document.getElementById("rc-actions") || {}).textContent || ""), null, { timeout: 15000 }).catch(() => {});
  await p.locator("#rc-actions button", { hasText: "ส่งคลิปวิดีโอ" }).click();
  await p.waitForSelector("#vid-sheet", { timeout: 5000 }).catch(() => {});
  ok(/กำลังย่อคลิป/.test(await p.evaluate(() => (document.getElementById("vid-sheet") || {}).textContent || "")) && !(await p.evaluate(() => window.__shared)),
    "คลิปใหญ่เกิน: ไม่แชร์ทั้งก้อน (Chrome จะปฏิเสธเงียบ ๆ) แต่ย่อก่อนพร้อมแถบความคืบหน้า");
  await p.waitForSelector("#vid-go", { timeout: 60000 }).catch(() => {});
  await p.click("#vid-go");
  await p.waitForFunction(() => window.__shared, null, { timeout: 5000 }).catch(() => {});
  const big = await p.evaluate(async () => {
    const f = window.__shared && window.__shared.files[0], b = await MDB.get("vid:7001"), l = S.lessons.find((x) => x.id === 7001);
    let dur = 0;
    if (f) { const v = document.createElement("video"); v.muted = true; v.src = URL.createObjectURL(f); await new Promise((r) => { v.onloadedmetadata = r; v.onerror = r; setTimeout(r, 5000); }); dur = v.duration; }
    return f && { name: f.name, type: f.type, size: f.size, stored: b.size, meta: l.media.size, mname: l.media.name, dur, sheet: !!document.getElementById("vid-sheet") };
  });
  ok(big && big.type === "video/mp4" && /\.mp4$/.test(big.name) && big.size < 1024 * 1024 && big.size < size / 3,
    "ย่อแล้วแตะ “ส่งคลิปเลย”: ได้ MP4 " + (big && Math.round(big.size / 1024)) + " KB (จาก " + Math.round(size / 1024) + " KB)");
  ok(big && Math.abs(big.dur - 8) < 1, "คลิปที่ย่อแล้วเล่นได้ ยาวเท่าเดิม (" + (big && big.dur && big.dur.toFixed(1)) + " วิ)");
  ok(big && big.stored === big.size && big.meta === big.size && /\.mp4$/.test(big.mname) && !big.sheet, "เก็บคลิปที่ย่อแทนของเดิม ครั้งหน้าส่งได้ทันที");
  await p.evaluate(() => closeModal());

  // ย่อไม่ได้ (เครื่องไม่มีตัวเข้ารหัส) → บอกให้ส่งจากแกลเลอรี ไม่เงียบ
  await p.evaluate(async () => { await MDB.put("vid:7001", window.__keep); window.__videoCodecs = ["nope"]; shareClip(7001); });
  await p.waitForFunction(() => /ส่งจากแอปไม่ได้/.test((document.getElementById("vid-sheet") || {}).textContent || ""), null, { timeout: 15000 }).catch(() => {});
  ok(/แกลเลอรี/.test(await p.evaluate(() => (document.getElementById("vid-sheet") || {}).textContent || "")), "ย่อไม่ได้: บอกตรง ๆ ให้ส่งจากแกลเลอรี + ปุ่มบันทึกคลิป");
  await p.click("#vid-x");
  await p.evaluate(() => { window.__videoCodecs = ["vp9"]; window.__videoLimits = null; });

  // แชร์ล้ม (เช่นแอปปลายทางไม่รับ) → ขึ้นข้อความ ไม่เงียบ
  await p.evaluate(() => { navigator.share = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError")); shareClip(7001); });
  await p.waitForTimeout(600);
  ok(/ส่งไม่สำเร็จ/.test(await toastText(p)), "แชร์ไม่ผ่าน: ขึ้นข้อความบอก ไม่เงียบเหมือนเดิม");

  // แนบคลิปใหญ่: ย่อให้ตั้งแต่ตอนแนบ
  await p.evaluate(() => {
    window.__videoLimits = { share: 1024 * 1024, target: 400 * 1024, minBps: 150000 };
    S.lessons.unshift({ id: 7002, date: todayStr(), time: "17:00", kind: "private", duration: 1, rate: 0, heads: 1, courseId: null,
      attendance: "present", student: "น้องคลิป", topic: "Fill", notes: "", scores: [], practiceItems: [], updatedAt: nowISO() });
    save(); openEdit(7002);
  });
  await p.setInputFiles("#media-inp", clip);
  await p.waitForFunction(() => /กำลังย่อคลิป/.test((document.getElementById("media-block") || {}).textContent || ""), null, { timeout: 15000 })
    .then(() => ok(true, "แนบคลิปใหญ่: โชว์แถบ “กำลังย่อคลิป”"), () => ok(false, "ไม่เห็นแถบย่อคลิปตอนแนบ"));
  await p.evaluate(() => saveLesson());
  ok(/รอย่อคลิปเสร็จ/.test(await toastText(p)), "กดบันทึกระหว่างย่อ: ให้รอก่อน (คลิปไม่หาย)");
  await p.waitForFunction(() => EF.media && EF.media.video, null, { timeout: 60000 }).catch(() => {});
  const att = await p.evaluate(() => ({ m: EF.media, b: PEND.puts["vid:7002"] && PEND.puts["vid:7002"].size }));
  ok(att.m && att.m.type === "video/mp4" && att.b < 1024 * 1024 && att.m.size === att.b && /\.mp4$/.test(att.m.name) && att.m.clean === 1,
    "แนบเสร็จ: เก็บเป็น MP4 ที่ย่อแล้ว " + Math.round((att.b || 0) / 1024) + " KB");
  await p.evaluate(() => { saveLesson(); window.__videoLimits = null; });
  await p.waitForTimeout(800);

  // คลิปที่แนบก่อนรุ่นนี้ (ภาพส่งผู้ปกครองมีปุ่ม ▶ ติด) → ทำหน้าปกใหม่ให้เอง
  const fixed = await p.evaluate(async () => {
    const l = S.lessons.find((x) => x.id === 7002); delete l.media.clean; await MDB.put("media:7002", "data:image/jpeg;base64,AAAA"); save();
    await window.__videoFixPosters();
    const m = await MDB.get("media:7002");
    return { clean: l.media.clean, poster: /^data:image\/jpeg/.test(m) && m.length > 1000 };
  });
  ok(fixed.clean === 1 && fixed.poster, "คลิปเก่า: สร้างภาพหน้าปกใหม่ (ไม่มีปุ่ม ▶) จากคลิปในเครื่องให้เอง");

  // คลิปยาวเกิน 10 นาที
  await p.evaluate(() => openEdit(7001));
  await p.setInputFiles("#media-inp", path.join(TMP, "long.webm"));
  await p.waitForFunction(() => Array.from(document.querySelectorAll(".toast")).some((t) => /10 นาที/.test(t.textContent)), null, { timeout: 15000 }).catch(() => {});
  ok(/ไม่เกิน 10 นาที/.test(await toastText(p)) && await p.evaluate(() => EF.media && EF.media.dur <= 9 && !PEND.puts["vid:7001"]), "คลิปยาว 11 นาที: ไม่รับ และคลิปเดิมยังอยู่");

  // เปลี่ยนเป็นรูป → ไฟล์คลิปถูกลบตอนบันทึก
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDK+mmyAAAAABJRU5ErkJggg==", "base64");
  await p.setInputFiles("#media-inp", { name: "pic.png", mimeType: "image/png", buffer: png });
  await p.waitForFunction(() => EF.media && !EF.media.video, null, { timeout: 8000 }).catch(() => {});
  await p.evaluate(() => saveLesson());
  await p.waitForTimeout(800);
  ok(await p.evaluate(async () => !(await MDB.get("vid:7001")) && !S.lessons.find((x) => x.id === 7001).media.video), "เปลี่ยนเป็นรูปแล้วบันทึก: ไฟล์คลิปเดิมถูกลบ ไม่ค้างกินที่");

  await p.evaluate(async () => { await MDB.put("vid:123456", new Blob(["x"])); window.__videoSweep(); });
  await p.waitForTimeout(500);
  ok(await p.evaluate(async () => !(await MDB.get("vid:123456"))), "คลิปของคาบที่ไม่มีแล้วถูกเก็บกวาดเอง");
  ok(!errs.length, "ไม่มี error ใน console" + (errs.length ? ": " + errs.join(" | ") : ""));

  await ctx.close(); await browser.close(); server.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fail.length ? "\n✗ ไม่ผ่าน " + fail.length + " ข้อ" : "\n✓ ผ่านทั้งหมด");
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
