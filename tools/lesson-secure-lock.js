/* ชั้นเว็บแอป: ล็อกหน้าจอแบบเข้ารหัสมาตรฐาน — tools/update-lesson.py ฝังไฟล์นี้ไว้ท้าย lesson/index.html
   แก้ที่ tools/lesson-secure-lock.js แล้วรัน update-lesson.py อย่าแก้ใน index.html ตรง ๆ

   เดิมแอปเก็บรหัสผ่านและรหัสกู้คืนด้วยแฮช 32 บิต (djb2) ซึ่งถอดย้อนหรือหาค่าที่ชนกันได้ในเสี้ยววินาที
   ชั้นนี้เปลี่ยนเป็น PBKDF2-SHA256 · 600,000 รอบ · salt สุ่ม 16 ไบต์ต่อค่า (เกณฑ์ OWASP)
   ผ่าน WebCrypto ของเบราว์เซอร์เอง ไม่มีไลบรารีจากข้างนอก

   • รหัสเดิมยังเข้าได้ทันที — ล็อกอินสำเร็จครั้งแรกจะเก็บใหม่เป็นแบบเข้ารหัสให้เอง
   • รหัสกู้คืนแบบเดิมเปลี่ยนเองไม่ได้ (ไม่รู้ตัวรหัส) จึงชวนให้สร้างใหม่หลังล็อกอิน
   • รหัสกู้คืนสุ่มด้วย crypto.getRandomValues แทน Math.random
   • เปิดแบบไม่มี WebCrypto (เช่นไฟล์ในเครื่อง file://) จะใช้วิธีเดิมของแอปต่อไป */
(function () {
  "use strict";
  var subtle = window.crypto && window.crypto.subtle;
  var NEED = ["doLogin", "doResetPw", "resetCheckPw", "doChangePw", "saveRecoveryCode",
              "checkRecoveryCode", "makeRecoveryCode", "regenRecoveryCode", "normalizeCode",
              "hashPw", "lsGet", "lsSet", "startApp", "showRecoveryCode", "shakeEl", "toast", "closeModal"];
  for (var i = 0; i < NEED.length; i++) if (typeof window[NEED[i]] !== "function") {
    window.__secureLock = "missing:" + NEED[i];          // ชุดทดสอบจับค่านี้ ถ้ารุ่นใหม่เปลี่ยนชื่อฟังก์ชัน
    return;
  }
  if (!subtle || !window.TextEncoder) { window.__secureLock = "no-webcrypto"; return; }

  var ITER = 600000, PREFIX = "pbkdf2-sha256$";
  var legacyHash = window.hashPw;

  function b64(u8) { var s = ""; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }
  function unb64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function derive(pw, salt, iter) {
    return subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"])
      .then(function (k) { return subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt, iterations: iter }, k, 256); })
      .then(function (bits) { return new Uint8Array(bits); });
  }
  function makeHash(pw) {
    var salt = crypto.getRandomValues(new Uint8Array(16));
    return derive(pw, salt, ITER).then(function (h) { return PREFIX + ITER + "$" + b64(salt) + "$" + b64(h); });
  }
  function same(a, b) { if (a.length !== b.length) return false; var d = 0; for (var i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }
  function verify(pw, stored) {
    if (!stored) return Promise.resolve(false);
    if (stored.indexOf(PREFIX) !== 0) return Promise.resolve(legacyHash(pw) === stored);
    var p = stored.slice(PREFIX.length).split("$"), iter = +p[0];
    if (p.length !== 3 || !(iter > 0)) return Promise.resolve(false);
    return derive(pw, unb64(p[1]), iter).then(function (h) { return same(h, unb64(p[2])); });
  }
  function isLegacy(k) { var v = lsGet(k); return !!v && v.indexOf(PREFIX) !== 0; }
  function store(k, pw) { return makeHash(pw).then(function (h) { lsSet(k, h); }); }
  function busy(btn, on) { if (btn) { btn.disabled = on; btn.classList.toggle("busy", on); } }
  function el(id) { return document.getElementById(id); }

  window.makeRecoveryCode = function () {
    var alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", r = crypto.getRandomValues(new Uint8Array(12)), out = [];
    for (var g = 0; g < 3; g++) { var s = ""; for (var i = 0; i < 4; i++) s += alpha.charAt(r[g * 4 + i] % 32); out.push(s); }
    return out.join("-");
  };
  // คืน Promise<boolean> (เดิมคืน boolean ทันที) — ทุกจุดที่เรียกถูกแทนด้วยตัวด้านล่างแล้ว
  window.saveRecoveryCode = function (code) {
    return store("td_rec", normalizeCode(code)).then(function () { return true; }, function () { return false; });
  };
  window.checkRecoveryCode = function (v) { return verify(normalizeCode(v), lsGet("td_rec")); };

  function offerNewCode() {
    if (!isLegacy("td_rec")) return;
    setTimeout(function () {
      toast("รหัสกู้คืนเดิมเป็นแบบเก่า · สร้างใหม่ให้ปลอดภัยขึ้น", { label: "สร้างใหม่", fn: function () { regenRecoveryCode(); } });
    }, 1200);
  }

  var loginBusy = false;
  window.doLogin = function () {
    if (loginBusy) return;
    var inp = el("pw-input"), pw = inp.value.trim(), err = el("login-err"), btn = el("login-btn");
    err.textContent = "";
    if (!pw) { err.textContent = "กรุณาใส่รหัสผ่าน"; inp.focus(); return; }
    var stored = lsGet("td_pw");
    if (!stored && pw.length < 4) { err.textContent = "ตั้งรหัสอย่างน้อย 4 ตัวอักษร"; return; }
    loginBusy = true; busy(btn, true);
    var run;
    if (!stored) {
      run = store("td_pw", pw).then(function () {
        var code = makeRecoveryCode();
        return saveRecoveryCode(code).then(function () { showRecoveryCode(code, function () { startApp(); }); });
      }, function () { err.textContent = "บันทึกรหัสไม่สำเร็จ — เบราว์เซอร์ไม่ยอมให้เก็บข้อมูล"; });
    } else {
      run = verify(pw, stored).then(function (ok) {
        if (!ok) { err.textContent = "รหัสผ่านไม่ถูกต้อง"; inp.value = ""; inp.focus(); shakeEl(inp); return; }
        var up = isLegacy("td_pw") ? store("td_pw", pw).catch(function () {}) : Promise.resolve();
        return up.then(function () { startApp(); offerNewCode(); });
      });
    }
    run.catch(function () { err.textContent = "ตรวจรหัสไม่สำเร็จ ลองอีกครั้ง"; })
       .then(function () { loginBusy = false; busy(btn, false); });
  };

  var resetBusy = false, changeBusy = false;
  window.doResetPw = function () {
    if (resetBusy) return;
    var code = el("rec-code").value, p1 = el("rec-pw1").value, p2 = el("rec-pw2").value, err = el("rec-err");
    if (p1.length < 4) { err.textContent = "รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร"; return; }
    if (p1 !== p2) { err.textContent = "รหัสยืนยันไม่ตรงกัน"; return; }
    err.textContent = "กำลังตรวจ…"; resetBusy = true;
    checkRecoveryCode(code).then(function (ok) {
      if (!ok) { err.textContent = "รหัสกู้คืนไม่ถูกต้อง"; return; }
      return store("td_pw", p1).then(function () {
        // รหัสที่ใช้แล้วถูกแทนที่ทันที สำเนาที่จดไว้จะใช้ซ้ำไม่ได้
        var fresh = makeRecoveryCode();
        return saveRecoveryCode(fresh).then(function () { showRecoveryCode(fresh, function () { startApp(); }); });
      }, function () { err.textContent = "บันทึกไม่สำเร็จ"; });
    }).catch(function () { err.textContent = "ตรวจรหัสไม่สำเร็จ ลองอีกครั้ง"; })
      .then(function () { resetBusy = false; });
  };

  window.resetCheckPw = function () {
    var i = el("rst-pw"), e = el("rst-err"), stored = lsGet("td_pw");
    if (!i || !i.value) { if (e) e.textContent = "ใส่รหัสผ่านก่อน"; return; }
    if (!stored) { RST.step = 3; showFactoryReset(); return; }
    if (e) e.textContent = "กำลังตรวจ…";
    verify(i.value, stored).then(function (ok) {
      if (!ok) { if (e) e.textContent = "รหัสผ่านไม่ถูกต้อง"; shakeEl(i); i.value = ""; return; }
      RST.step = 3; showFactoryReset();
    });
  };

  window.doChangePw = function () {
    if (changeBusy) return;
    var o = el("cp0").value, n = el("cp1").value, c = el("cp2").value, e = el("cp-err");
    if (n.length < 4) { e.textContent = "รหัสใหม่ต้องมีอย่างน้อย 4 ตัวอักษร"; return; }
    if (n !== c) { e.textContent = "รหัสยืนยันไม่ตรงกัน"; return; }
    e.textContent = "กำลังตรวจ…"; changeBusy = true;
    verify(o, lsGet("td_pw")).then(function (ok) {
      if (!ok) { e.textContent = "รหัสเดิมไม่ถูกต้อง"; return; }
      return store("td_pw", n).then(function () { closeModal(); toast("เปลี่ยนรหัสผ่านแล้ว"); });
    }).catch(function () { e.textContent = "บันทึกไม่สำเร็จ"; })
      .then(function () { changeBusy = false; });
  };

  window.regenRecoveryCode = function () {
    var code = makeRecoveryCode();
    saveRecoveryCode(code).then(function (ok) {
      if (!ok) { toast("บันทึกไม่สำเร็จ"); return; }
      showRecoveryCode(code, function () { renderAll(); toast("ตั้งรหัสกู้คืนใหม่แล้ว"); });
    });
  };

  // ปุ่มเข้าสู่ระบบถูกผูกกับ doLogin ตัวเดิมไว้ตอนเปิดแอป — ผูกใหม่ให้เรียกตัวนี้
  var b = el("login-btn");
  if (b && b.parentNode) {
    var nb = b.cloneNode(true);
    b.parentNode.replaceChild(nb, b);
    nb.addEventListener("click", function () { doLogin(); });
  }
  window.__secureLock = "on";
})();
