/* ชั้นเว็บแอป: ปลดล็อกเร็ว — tools/update-lesson.py ฝังไฟล์นี้ไว้ท้าย lesson/index.html
   แก้ที่ tools/lesson-layer/15-quick-unlock.js แล้วรัน update-lesson.py อย่าแก้ใน index.html ตรง ๆ

   1) แป้นตัวเลข: ถ้ารหัสผ่านเป็นตัวเลขล้วน (10-secure-lock.js จดไว้ใน td_pw_num) หน้าล็อกจะโชว์แป้น 0–9 ปุ่มใหญ่
      แทนแป้นพิมพ์ของเครื่อง (iPad ไม่มีแป้นตัวเลขล้วนให้เว็บเรียกได้) · สลับกลับเป็นแป้นพิมพ์ปกติได้
   2) ลายนิ้วมือ / Face ID: ใช้ WebAuthn (passkey) ของเครื่อง ลงทะเบียนทีละเครื่อง เก็บแค่รหัสกุญแจสาธารณะ (td_bio)
      ตอนปลดล็อกตรวจ challenge, origin, ธงยืนยันตัวตน (UV) และลายเซ็นด้วยกุญแจสาธารณะก่อนเข้าแอป
      ลายนิ้วมือไม่เคยออกจากเครื่อง แอปไม่เห็น · รหัสผ่านเดิมยังใช้ได้เสมอ */
(function () {
  "use strict";
  var NEED = ["doLogin", "startApp", "lockApp", "openMenu", "showModal", "closeModal", "toast", "lsGet", "lsSet"];
  for (var i = 0; i < NEED.length; i++) if (typeof window[NEED[i]] !== "function") {
    window.__quickUnlock = "missing:" + NEED[i];
    return;
  }
  var subtle = window.crypto && window.crypto.subtle;
  function el(id) { return document.getElementById(id); }
  function ios() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); }
  // ชื่อภาษาอังกฤษมีเว้นวรรคหน้า-หลัง ต่อกับคำไทยได้เลย ("ปลดล็อกด้วย Face ID / Touch ID แล้ว")
  function bioName() { return ios() ? " Face ID / Touch ID " : "ลายนิ้วมือ"; }
  function bioIcon() { return ios() ? "🙂" : "👆"; }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function readJSON(k) { try { return JSON.parse(lsGet(k) || "null"); } catch (e) { return null; } }

  /* ── 1) แป้นตัวเลข ── */
  function padWanted() { return lsGet("td_pw_num") === "1" && !!lsGet("td_pw") && lsGet("td_pad") !== "off"; }
  function buzz() { try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) {} }
  function key(label, aria, fn) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "btn-g qu-key"; b.textContent = label;
    if (aria) b.setAttribute("aria-label", aria);
    b.addEventListener("click", function () { buzz(); fn(); });
    return b;
  }
  function type(d) { var inp = el("pw-input"); inp.value += d; el("login-err").textContent = ""; }
  function back() { var inp = el("pw-input"); inp.value = inp.value.slice(0, -1); }
  function renderLock() {
    var inp = el("pw-input"), btn = el("login-btn");
    if (!inp || !btn) return;
    var old = el("qu-box"); if (old) old.parentNode.removeChild(old);
    var box = document.createElement("div"); box.id = "qu-box";
    var pad = padWanted();
    if (pad) {
      inp.setAttribute("inputmode", "none");       // ไม่ให้แป้นพิมพ์ของเครื่องเด้งขึ้นมาบังแป้นตัวเลข
      var grid = document.createElement("div"); grid.id = "qu-pad";
      "123456789".split("").forEach(function (d) { grid.appendChild(key(d, null, function () { type(d); })); });
      grid.appendChild(key("ล้าง", "ล้างรหัส", function () { inp.value = ""; }));
      grid.appendChild(key("0", null, function () { type("0"); }));
      grid.appendChild(key("⌫", "ลบตัวสุดท้าย", back));
      box.appendChild(grid);
    } else {
      inp.removeAttribute("inputmode");
    }
    inp.parentNode.parentNode.insertBefore(box, btn);   // อยู่ระหว่างช่องรหัสกับปุ่มเข้าสู่ระบบ

    var foot = document.createElement("div"); foot.id = "qu-foot";
    if (readJSON("td_bio")) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "btn-g"; b.id = "qu-bio";
      b.style.cssText = "width:100%;margin-bottom:10px;";
      b.textContent = bioIcon() + " ปลดล็อกด้วย" + bioName();
      b.addEventListener("click", bioUnlock);
      foot.appendChild(b);
    }
    if (lsGet("td_pw_num") === "1" && lsGet("td_pw")) {
      var t = document.createElement("button");
      t.type = "button"; t.className = "linkbtn"; t.id = "qu-toggle";
      t.style.cssText = "display:block;margin:0 auto 8px;font-size:13px;";
      t.textContent = pad ? "⌨ ใช้แป้นพิมพ์ของเครื่อง" : "🔢 ใช้แป้นตัวเลข";
      t.addEventListener("click", function () {
        try { lsSet("td_pad", pad ? "off" : "on"); } catch (e) {}
        renderLock();
        if (pad) setTimeout(function () { el("pw-input").focus(); }, 30);
      });
      foot.appendChild(t);
    }
    var old2 = el("qu-foot"); if (old2) old2.parentNode.removeChild(old2);
    btn.parentNode.insertBefore(foot, btn.nextSibling);
  }
  var css = document.createElement("style");
  css.textContent =
    "#qu-pad{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:0 0 14px;}" +
    "#qu-pad .qu-key{min-height:60px;font-size:24px;font-weight:700;padding:0;font-variant-numeric:tabular-nums;touch-action:manipulation;}" +
    "#qu-pad .qu-key[aria-label]{font-size:16px;}" +
    "@media (min-width:600px){#qu-pad .qu-key{min-height:66px;}}";
  document.head.appendChild(css);

  /* ── 2) ลายนิ้วมือ / Face ID (WebAuthn) ── */
  function b64u(buf) {
    var u = new Uint8Array(buf), s = "";
    for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64u(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
    var b = atob(s), u = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return u;
  }
  function rnd(n) { return crypto.getRandomValues(new Uint8Array(n)); }
  function bioAvailable() {
    if (!window.PublicKeyCredential || !navigator.credentials || !subtle || !window.isSecureContext) return Promise.resolve(false);
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== "function") return Promise.resolve(false);
    return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(function () { return false; });
  }
  // ลายเซ็น ES256 จาก WebAuthn เป็น DER — WebCrypto ต้องการ r||s อย่างละ 32 ไบต์
  function derToRaw(der) {
    var p = 2; if (der[1] & 0x80) p += der[1] & 0x7f;
    function int() {
      if (der[p++] !== 0x02) throw new Error("bad sig");
      var len = der[p++], v = der.slice(p, p + len); p += len;
      while (v.length > 32 && v[0] === 0) v = v.slice(1);
      var out = new Uint8Array(32); out.set(v, 32 - v.length); return out;
    }
    var r = int(), s = int(), raw = new Uint8Array(64); raw.set(r, 0); raw.set(s, 32); return raw;
  }
  function verifySig(bio, authData, clientData, sig) {
    if (!bio.pub) return Promise.resolve(true);    // เบราว์เซอร์เก่าไม่ให้กุญแจสาธารณะ: เหลือตรวจ UV + challenge + origin
    return subtle.digest("SHA-256", clientData).then(function (h) {
      var msg = new Uint8Array(authData.byteLength + 32);
      msg.set(new Uint8Array(authData), 0); msg.set(new Uint8Array(h), authData.byteLength);
      var es = bio.alg === -7;
      var algo = es ? { name: "ECDSA", namedCurve: "P-256" } : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
      return subtle.importKey("spki", unb64u(bio.pub), algo, false, ["verify"]).then(function (k) {
        return subtle.verify(es ? { name: "ECDSA", hash: "SHA-256" } : algo, k, es ? derToRaw(new Uint8Array(sig)) : sig, msg);
      });
    });
  }
  function enrollBio() {
    var challenge = rnd(32);
    return navigator.credentials.create({ publicKey: {
      rp: { name: "ครูต้า" },
      user: { id: rnd(16), name: "ครูต้า", displayName: "ครูต้า · บันทึกการสอน" },
      challenge: challenge,
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
      attestation: "none", timeout: 60000
    } }).then(function (cred) {
      var r = cred.response, pub = null, alg = -7;
      try { if (r.getPublicKey) { var k = r.getPublicKey(); if (k) pub = b64u(k); } } catch (e) {}
      try { if (r.getPublicKeyAlgorithm) alg = r.getPublicKeyAlgorithm(); } catch (e) {}
      lsSet("td_bio", JSON.stringify({ id: b64u(cred.rawId), pub: pub, alg: alg, at: Date.now() }));
      return true;
    });
  }
  // คืน Promise<boolean> — true เมื่อเจ้าของเครื่องยืนยันตัวตนสำเร็จและตรวจครบทุกข้อ
  function bioCheck() {
    var bio = readJSON("td_bio");
    if (!bio || !bio.id) return Promise.reject(new Error("ยังไม่ได้ตั้ง" + bioName() + "บนเครื่องนี้"));
    var challenge = rnd(32);
    return navigator.credentials.get({ publicKey: {
      challenge: challenge,
      allowCredentials: [{ type: "public-key", id: unb64u(bio.id), transports: ["internal"] }],
      userVerification: "required", timeout: 60000
    } }).then(function (a) {
      var r = a.response, cd = JSON.parse(new TextDecoder().decode(r.clientDataJSON));
      var ad = new Uint8Array(r.authenticatorData), flags = ad[32];
      if (b64u(a.rawId) !== bio.id) return false;
      if (cd.type !== "webauthn.get" || cd.challenge !== b64u(challenge) || cd.origin !== location.origin) return false;
      if (!(flags & 0x01) || !(flags & 0x04)) return false;     // UP + UV: แตะจริงและสแกนผ่าน
      return verifySig(bio, r.authenticatorData, r.clientDataJSON, r.signature);
    });
  }
  function bioError(e) {
    var n = e && e.name;
    if (n === "NotAllowedError" || n === "AbortError") return "";            // ผู้ใช้กดยกเลิก / หมดเวลา
    if (n === "InvalidStateError") return "เครื่องนี้มีกุญแจของแอปอยู่แล้ว ลองอีกครั้ง";
    return (e && e.message) || "ใช้" + bioName() + "ไม่สำเร็จ";
  }
  var bioBusy = false;
  function bioUnlock() {
    if (bioBusy) return;
    var err = el("login-err"); bioBusy = true; err.textContent = "";
    bioCheck().then(function (ok) {
      if (ok) { el("pw-input").value = ""; startApp(); }
      else err.textContent = "ยืนยันตัวตนไม่ผ่าน — ใช้รหัสผ่านแทน";
    }, function (e) {
      var m = bioError(e);
      err.textContent = m ? m + " — ใช้รหัสผ่านแทนได้" : "";
    }).then(function () { bioBusy = false; });
  }

  /* ── หน้าตั้งค่า ── */
  function openBio() {
    var on = !!readJSON("td_bio");
    showModal('<div class="mhead"><div class="mtitle">' + bioIcon() + ' ปลดล็อกด้วย' + bioName() + '</div>' +
      '<button class="ib" type="button" onclick="closeModal()" aria-label="ปิด" style="font-size:19px;">✕</button></div>' +
      '<div id="bio-body"><div class="hint">กำลังตรวจเครื่อง…</div></div>', "400px");
    bioAvailable().then(function (ok) {
      var box = el("bio-body"); if (!box) return;
      if (!ok && !on) {
        box.innerHTML = '<div class="warnline">เครื่องหรือเบราว์เซอร์นี้ยังไม่มี' + bioName() + 'ให้เว็บใช้ — ' +
          'ตั้งลายนิ้วมือ/ใบหน้าในการตั้งค่าเครื่องก่อน แล้วเปิดแอปจากไอคอนบนหน้าโฮม (Chrome หรือ Safari)</div>';
        return;
      }
      box.innerHTML = on
        ? '<div class="vline ok" style="margin-bottom:12px;">✓ เปิดอยู่บนเครื่องนี้</div>' +
          '<div class="hint" style="margin-bottom:12px;">หน้าล็อกมีปุ่ม <b>' + bioIcon() + ' ปลดล็อกด้วย' + bioName() + '</b> · รหัสผ่านยังใช้ได้เสมอ</div>' +
          '<div style="display:flex;gap:8px;"><button class="btn-g" type="button" id="bio-test" style="flex:1;">ลองสแกน</button>' +
          '<button class="btn-d" type="button" id="bio-off" style="flex:1;">ปิด</button></div>'
        : '<div class="hint" style="margin-bottom:12px;line-height:1.8;">เปิดแอปครั้งต่อไปแตะปุ่มแล้วสแกน ไม่ต้องพิมพ์รหัส<br>' +
          '• ตั้งทีละเครื่อง (iPad และมือถือแยกกัน)<br>• ลายนิ้วมือ/ใบหน้าอยู่ในเครื่อง แอปไม่เห็น และไม่ได้ส่งไปไหน<br>' +
          '• เครื่องอาจถามว่า <b>บันทึกพาสคีย์</b> สำหรับ potagomo.github.io — กดบันทึก/ดำเนินการต่อ<br>• ลืมรหัสผ่านก็ยังใช้รหัสกู้คืนได้ตามเดิม</div>' +
          '<button class="btn-brass" type="button" id="bio-on" style="width:100%;">' + bioIcon() + ' เปิดใช้' + bioName() + '</button>';
      box.insertAdjacentHTML("beforeend", '<div id="bio-err" class="hint" style="margin-top:10px;color:#B91C1C;"></div>');
      var say = function (t) { var e = el("bio-err"); if (e) e.textContent = t; };
      var bOn = el("bio-on"), bOff = el("bio-off"), bTest = el("bio-test");
      if (bOn) bOn.addEventListener("click", function () {
        bOn.disabled = true; say("");
        enrollBio().then(function () { return bioCheck(); }).then(function (ok) {
          if (!ok) { lsDel("td_bio"); say("ตรวจกุญแจไม่ผ่าน ลองอีกครั้ง"); return; }
          toast("เปิดใช้" + bioName() + "แล้ว"); openBio();
        }, function (e) { lsDel("td_bio"); say(bioError(e) || "ยกเลิกแล้ว"); }).then(function () { bOn.disabled = false; });
      });
      if (bTest) bTest.addEventListener("click", function () {
        say("");
        bioCheck().then(function (ok) { say(""); toast(ok ? "✓ สแกนผ่าน" : "ตรวจไม่ผ่าน"); }, function (e) { say(bioError(e) || "ยกเลิกแล้ว"); });
      });
      if (bOff) bOff.addEventListener("click", function () {
        if (!bOff.dataset.armed) { bOff.dataset.armed = "1"; bOff.textContent = "แตะอีกครั้งเพื่อปิด"; return; }
        lsDel("td_bio"); toast("ปิดแล้ว · ลบพาสคีย์ของแอปในการตั้งค่ารหัสผ่านของเครื่องได้ถ้าต้องการ"); openBio();
      });
    });
  }
  window.openBio = openBio;

  var origMenu = window.openMenu;
  window.openMenu = function () {
    origMenu.apply(this, arguments);
    var lock = document.querySelector('#modal-root button.srow[onclick="lockApp()"]');
    if (!lock) return;
    var on = !!readJSON("td_bio");
    var b = document.createElement("button");
    b.className = "srow"; b.type = "button"; b.id = "bio-row"; b.style.marginBottom = "8px";
    b.innerHTML = '<span style="font-size:18px;flex-shrink:0;">' + bioIcon() + '</span><div style="min-width:0;"><div style="font-weight:600;">ปลดล็อกด้วย' + bioName() + '</div>' +
      '<div style="font-size:11px;color:#5A5A5A;margin-top:2px;">' + (on ? "เปิดอยู่บนเครื่องนี้" : "ไม่ต้องพิมพ์รหัสทุกครั้ง · ตั้งทีละเครื่อง") + '</div></div>';
    b.addEventListener("click", function () { closeModal(); openBio(); });
    lock.parentNode.insertBefore(b, lock);
  };

  var origLock = window.lockApp;
  window.lockApp = function () { origLock.apply(this, arguments); renderLock(); };

  renderLock();
  // เปิดแอปแล้วถามลายนิ้วมือเลย (Android) — Safari บน iPad ต้องให้ผู้ใช้แตะก่อน จึงรอแตะปุ่ม
  if (readJSON("td_bio") && !ios() && el("login-wrap") && el("login-wrap").style.display !== "none" && el("app").style.display !== "block") {
    setTimeout(function () { if (el("app").style.display !== "block") bioUnlock(); }, 400);
  }

  window.__bioCheck = bioCheck;
  window.__quickUnlock = "on";
})();
