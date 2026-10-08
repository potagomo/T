#!/usr/bin/env node
/* ตรวจหน้าล็อกของ "ครูต้า — บันทึกการสอน": แป้นตัวเลข + ปลดล็อกด้วยลายนิ้วมือ (WebAuthn)
 *
 *   npm i playwright && node tools/test-quick-unlock.js
 *
 * ลายนิ้วมือใช้ "เครื่องยืนยันตัวตนจำลอง" ของ Chrome (CDP WebAuthn) ซึ่งสร้างกุญแจและเซ็นจริง
 * แอปจึงต้องตรวจลายเซ็นผ่านจริง · ออก 0 = ผ่าน, 1 = ไม่ผ่าน
 */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path");
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

const appOpen = (p) => p.evaluate(() => document.getElementById("app").style.display === "block");
const waitApp = (p) => p.waitForFunction(() => document.getElementById("app").style.display === "block", null, { timeout: 10000 }).then(() => true, () => false);

(async () => {
  await new Promise((r) => server.listen(0, r));
  const URL_ = "http://localhost:" + server.address().port + PREFIX + "lesson/";
  const browser = await chromium.launch({ executablePath: chromiumPath() });

  console.log("มือถือ Android — แป้นตัวเลข + ลายนิ้วมือ");
  {
    const ctx = await browser.newContext({ ...devices["Galaxy S9+"], serviceWorkers: "block" });
    const p = await ctx.newPage(); const errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    const cdp = await ctx.newCDPSession(p);
    await cdp.send("WebAuthn.enable");
    const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
      protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });

    await p.goto(URL_);
    ok(await p.evaluate(() => window.__quickUnlock === "on"), "ชั้นปลดล็อกเร็วทำงาน");
    ok(await p.evaluate(() => !document.getElementById("qu-pad")), "ยังไม่มีรหัส (ตั้งครั้งแรก): ไม่โชว์แป้นตัวเลข เผื่ออยากตั้งรหัสเป็นตัวอักษร");
    // รหัสเดิมแบบเก่า (ตัวเลข) → ล็อกอินครั้งแรกจดว่าเป็นตัวเลขล้วน
    await p.evaluate(() => { lsSet("td_pw", hashPw("2580")); document.getElementById("pw-input").value = "2580"; doLogin(); });
    ok(await waitApp(p), "เข้าด้วยรหัส 2580");
    ok(await p.evaluate(() => localStorage.getItem("td_pw_num") === "1" && !/2580/.test(JSON.stringify(localStorage))),
      "จดแค่ว่ารหัสเป็นตัวเลขล้วน (ไม่มีตัวรหัสในเครื่อง)");

    await p.evaluate(() => lockApp());
    ok(await p.evaluate(() => document.querySelectorAll("#qu-pad .qu-key").length === 12 && document.getElementById("pw-input").getAttribute("inputmode") === "none"),
      "ล็อกแล้ว: แป้นตัวเลข 12 ปุ่ม และไม่เรียกแป้นพิมพ์ของเครื่อง");
    const keyBox = await p.locator("#qu-pad .qu-key").first().boundingBox();
    ok(keyBox && keyBox.height >= 56, "ปุ่มแป้นตัวเลขสูง " + Math.round(keyBox.height) + "px (แตะง่าย)");
    const tap = async (s) => { for (const ch of s) await p.locator("#qu-pad .qu-key", { hasText: new RegExp("^" + ch + "$") }).click(); };
    await tap("2581"); await p.click("#login-btn");
    await p.waitForFunction(() => /ไม่ถูกต้อง/.test(document.getElementById("login-err").textContent), null, { timeout: 8000 }).catch(() => {});
    ok(!(await appOpen(p)) && await p.evaluate(() => document.getElementById("pw-input").value === ""), "กดรหัสผิด: ไม่เข้า และล้างช่องให้");
    await tap("25"); await p.locator("#qu-pad [aria-label='ลบตัวสุดท้าย']").click(); await tap("580");
    ok(await p.evaluate(() => document.getElementById("pw-input").value === "2580"), "ปุ่ม ⌫ ลบทีละตัว");
    await p.click("#login-btn");
    ok(await waitApp(p), "กดรหัสจากแป้นตัวเลขแล้วเข้าแอปได้");

    await p.evaluate(() => lockApp());
    await p.click("#qu-toggle");
    ok(await p.evaluate(() => !document.getElementById("qu-pad") && !document.getElementById("pw-input").hasAttribute("inputmode") && localStorage.getItem("td_pad") === "off"),
      "สลับเป็นแป้นพิมพ์ของเครื่องได้ และจำไว้");
    await p.click("#qu-toggle");
    ok(await p.evaluate(() => !!document.getElementById("qu-pad")), "สลับกลับเป็นแป้นตัวเลขได้");
    await p.evaluate(() => { document.getElementById("pw-input").value = "2580"; doLogin(); }); await waitApp(p);

    // ลายนิ้วมือ: เมนู › ความปลอดภัย › ปลดล็อกด้วยลายนิ้วมือ
    await p.evaluate(() => openMenu());
    ok(await p.evaluate(() => { const r = document.getElementById("bio-row"), l = document.querySelector('#modal-root button.srow[onclick="lockApp()"]'); return !!r && r.nextElementSibling === l && /ลายนิ้วมือ/.test(r.textContent); }),
      "เมนูความปลอดภัยมีแถว 👆 ปลดล็อกด้วยลายนิ้วมือ");
    await p.click("#bio-row");
    await p.waitForSelector("#bio-on", { timeout: 5000 }).catch(() => {});
    ok(await p.isVisible("#bio-on"), "เครื่องมีลายนิ้วมือ: โชว์ปุ่มเปิดใช้");
    await p.click("#bio-on");
    await p.waitForSelector("#bio-off", { timeout: 8000 }).catch(() => {});
    const bio = await p.evaluate(() => JSON.parse(localStorage.getItem("td_bio") || "null"));
    ok(bio && bio.id && bio.pub && bio.alg === -7, "เปิดใช้แล้ว: เก็บแค่รหัสกุญแจ + กุญแจสาธารณะ (ES256)");
    const creds = (await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials;
    ok(creds.length === 1 && creds[0].rpId === "localhost", "สร้างพาสคีย์ในเครื่อง 1 อัน ผูกกับเว็บแอปนี้");
    await p.evaluate(() => closeModal());

    await p.evaluate(() => lockApp());
    ok(await p.evaluate(() => /ลายนิ้วมือ/.test((document.getElementById("qu-bio") || {}).textContent || "")), "หน้าล็อกมีปุ่ม 👆 ปลดล็อกด้วยลายนิ้วมือ");
    ok(!(await appOpen(p)), "ล็อกเองแล้ว ไม่ถามลายนิ้วมือทันที (ไม่ปลดล็อกเอง)");
    await p.click("#qu-bio");
    ok(await waitApp(p), "สแกนผ่าน: เข้าแอป");

    // นิ้วไม่ผ่าน (UV ล้มเหลว)
    await p.evaluate(() => lockApp());
    await cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: false });
    await p.click("#qu-bio");
    await p.waitForTimeout(1500);
    ok(!(await appOpen(p)), "สแกนไม่ผ่าน: ไม่เข้าแอป · ใช้รหัสผ่านได้ (" + await p.evaluate(() => document.getElementById("login-err").textContent) + ")");
    await cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: true });

    // มีคนแก้กุญแจสาธารณะในเครื่อง → ลายเซ็นไม่ตรง ต้องไม่ผ่าน
    const good = await p.evaluate(() => localStorage.getItem("td_bio"));
    const other = await p.evaluate(async () => {
      const k = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
      const spki = new Uint8Array(await crypto.subtle.exportKey("spki", k.publicKey)); let s = ""; spki.forEach((b) => s += String.fromCharCode(b));
      return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    });
    await p.evaluate((pub) => { const b = JSON.parse(localStorage.getItem("td_bio")); b.pub = pub; localStorage.setItem("td_bio", JSON.stringify(b)); }, other);
    await p.click("#qu-bio"); await p.waitForTimeout(1500);
    ok(!(await appOpen(p)) && /ไม่ผ่าน/.test(await p.evaluate(() => document.getElementById("login-err").textContent)), "ลายเซ็นไม่ตรงกุญแจที่ลงทะเบียน: ไม่เข้าแอป");
    await p.evaluate((g) => localStorage.setItem("td_bio", g), good);

    // เปิดแอปใหม่: Android ถามลายนิ้วมือให้เอง
    await p.reload();
    ok(await waitApp(p), "เปิดแอปใหม่บนมือถือ: ถามลายนิ้วมือเองแล้วเข้าแอป ไม่ต้องแตะ");

    // เปลี่ยนรหัสเป็นตัวอักษร → แป้นตัวเลขหายเอง
    await p.evaluate(() => { openChangePw(); document.getElementById("cp0").value = "2580"; document.getElementById("cp1").value = "drum99"; document.getElementById("cp2").value = "drum99"; doChangePw(); });
    await p.waitForFunction(() => localStorage.getItem("td_pw_num") === "0", null, { timeout: 8000 }).catch(() => {});
    await p.evaluate(() => lockApp());
    ok(await p.evaluate(() => !document.getElementById("qu-pad") && !document.getElementById("qu-toggle")), "เปลี่ยนรหัสเป็นตัวอักษร: แป้นตัวเลขหายเอง");

    // ปิดลายนิ้วมือ
    await p.evaluate(() => { document.getElementById("pw-input").value = "drum99"; doLogin(); }); await waitApp(p);
    await p.evaluate(() => openBio()); await p.waitForSelector("#bio-off");
    await p.click("#bio-off"); await p.click("#bio-off");
    ok(await p.evaluate(() => !localStorage.getItem("td_bio")), "ปิดลายนิ้วมือได้ (แตะยืนยัน 2 ครั้ง)");
    await p.evaluate(() => { closeModal(); lockApp(); });
    ok(await p.evaluate(() => !document.getElementById("qu-bio")), "ปิดแล้ว: หน้าล็อกไม่มีปุ่มลายนิ้วมือ");
    ok(!errs.length, "ไม่มี error ใน console" + (errs.length ? ": " + errs.join(" | ") : ""));
    await ctx.close();
  }

  console.log("iPad — แป้นตัวเลข + Face ID ต้องแตะก่อน");
  {
    const ctx = await browser.newContext({ ...devices["iPad Pro 11"], serviceWorkers: "block" });
    const p = await ctx.newPage(); const errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    const cdp = await ctx.newCDPSession(p);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
      protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await p.goto(URL_);
    await p.evaluate(() => { lsSet("td_pw", hashPw("1234")); document.getElementById("pw-input").value = "1234"; doLogin(); });
    await waitApp(p);
    await p.evaluate(() => openBio()); await p.waitForSelector("#bio-on");
    ok(/Face ID/.test(await p.textContent("#bio-on")), "iPad เรียกว่า Face ID / Touch ID");
    await p.click("#bio-on"); await p.waitForSelector("#bio-off", { timeout: 8000 }).catch(() => {});
    await p.reload();
    await p.waitForTimeout(1200);
    ok(!(await appOpen(p)) && await p.isVisible("#qu-bio") && await p.evaluate(() => document.querySelectorAll("#qu-pad .qu-key").length === 12),
      "เปิดแอปใหม่บน iPad: รอให้แตะปุ่ม Face ID (Safari บังคับ) และมีแป้นตัวเลข");
    await p.click("#qu-bio");
    ok(await waitApp(p), "แตะปุ่ม Face ID แล้วเข้าแอป");
    ok(!errs.length, "ไม่มี error ใน console" + (errs.length ? ": " + errs.join(" | ") : ""));
    await ctx.close();
  }

  await browser.close(); server.close();
  console.log(fail.length ? "\n✗ ไม่ผ่าน " + fail.length + " ข้อ" : "\n✓ ผ่านทั้งหมด");
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
