/* ชั้นเว็บแอป: วิดเจ็ตหน้าจอโฮม — tools/update-lesson.py ฝังไฟล์นี้ไว้ท้าย lesson/index.html

   เว็บแอปสร้างวิดเจ็ตเองไม่ได้ จึงให้ตัวส่งบน Cloudflare (push-worker, รุ่น 3 ขึ้นไป) ถือ "ตารางสอน 8 วัน"
   ไว้ให้วิดเจ็ตอ่าน:  iPad → แอปฟรี Scriptable + สคริปต์ widget/scriptable.js
                      Samsung → แอปวิดเจ็ต android-widget/ (APK ที่ /T/widget/kruta-widget.apk)
   วิดเจ็ตใช้ "รหัสวิดเจ็ต" แยกจากรหัสเข้าใช้ (อ่านได้อย่างเดียว) เก็บใน S.settings.push.wkey จึงซิงค์ไปอีกเครื่องเอง */
(function () {
  "use strict";
  var NEED = ["save", "openMenu", "showModal", "closeModal", "toast", "esc", "copyText", "todayStr", "addDays",
              "rosterForDate", "rosterSkipped", "isClosedDate", "rosterEntryExists", "displayName", "getPlace"];
  for (var i = 0; i < NEED.length; i++) if (typeof window[NEED[i]] !== "function") { window.__widget = "missing:" + NEED[i]; return; }
  if (typeof window.__pushApi !== "function") { window.__widget = "missing:push"; return; }

  var DAYS = 8, NEED_VER = 3, SCRIPT = null;
  var api = window.__pushApi, cfg = window.__pushCfg;
  function lsj(k, v) {
    try {
      if (v === undefined) return JSON.parse(localStorage.getItem(k) || "null");
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v));
    } catch (e) { return null; }
  }
  function rnd() {
    var u = crypto.getRandomValues(new Uint8Array(24)), s = "";
    for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function wkey() { var c = cfg(); return c && c.wkey; }
  function hhmm(t) { var m = String(t || "").match(/^(\d{1,2})[:.](\d{2})/); return m ? ("0" + parseInt(m[1], 10)).slice(-2) + ":" + m[2] : ""; }

  /* ตาราง 8 วัน: คาบทุกสถานะ + ตารางประจำที่ยังไม่ได้ลงเป็นคาบ (นับเป็นรอยืนยัน) */
  function lessons() {
    var out = [], t = todayStr();
    for (var i = 0; i < DAYS; i++) {
      var d = addDays(t, i);
      S.lessons.forEach(function (l) {
        if (l.date !== d || !hhmm(l.time)) return;
        var pl = l.placeId != null && getPlace(l.placeId);
        out.push({ d: d, t: hhmm(l.time), m: Math.round((parseFloat(l.duration) || 1) * 60), n: displayName(l.student), k: l.kind || "school",
                   p: pl && pl.name ? pl.name : "", s: l.attendance || "present" });
      });
      rosterForDate(d).forEach(function (e) {
        if (!hhmm(e.time) || e.paused || (e.from && d < e.from) || rosterSkipped(e.id, d) || isClosedDate(d, e.kind) || rosterEntryExists(e, d)) return;
        var pl = e.placeId != null && getPlace(e.placeId);
        out.push({ d: d, t: hhmm(e.time), m: 60, n: displayName(e.student), k: e.kind || "school", p: pl && pl.name ? pl.name : "", s: "planned" });
      });
    }
    return out.sort(function (a, b) { return (a.d + a.t) < (b.d + b.t) ? -1 : 1; });
  }

  /* ส่งขึ้นตัวส่งเมื่อข้อมูลเปลี่ยน (หรือทุก 3 ชั่วโมงให้ "วันนี้" เลื่อนตาม) */
  var T = null, busy = false;
  function syncSoon(ms) { clearTimeout(T); T = setTimeout(function () { T = null; sync(false); }, ms == null ? 4000 : ms); }
  function sync(force, keepalive) {
    if (!cfg() || !wkey() || (busy && !keepalive) || !navigator.onLine) return Promise.resolve(false);
    var bad = lsj("td_wd_old");
    if (bad && !force && Date.now() - bad < 6 * 3600 * 1000) return Promise.resolve(false);
    var list = lessons(), h = JSON.stringify([wkey(), list]), last = lsj("td_wd_last") || {};
    if (!force && last.h === h && Date.now() - (last.at || 0) < 3 * 3600 * 1000) return Promise.resolve(false);
    busy = true; clearTimeout(T); T = null;
    return api("/widget-data", { wkey: wkey(), lessons: list }, keepalive).then(function () {
      busy = false; lsj("td_wd_last", { h: h, at: Date.now() }); lsj("td_wd_old", null); return true;
    }, function (e) {
      busy = false;
      if (/not found/.test(e.message)) lsj("td_wd_old", Date.now());   // ตัวส่งยังเป็นรุ่นก่อน 3
      return false;
    });
  }
  var origSave = window.save;
  window.save = function () { var r = origSave.apply(this, arguments); if (wkey()) syncSoon(); return r; };
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden" && T) sync(false, true);
    if (document.visibilityState === "visible") sync(false);
  });
  window.addEventListener("pagehide", function () { if (T) sync(false, true); });
  if (typeof window.startApp === "function") {
    var origStart = window.startApp;
    window.startApp = function () { var r = origStart.apply(this, arguments); setTimeout(function () { sync(false); }, 4000); return r; };
  }

  /* ── หน้าตั้งค่าวิดเจ็ต ── */
  function code() { var c = cfg(); return "KRUTAW1:" + btoa(unescape(encodeURIComponent(JSON.stringify({ u: c.url, k: c.wkey })))); }
  function ensureKey() {
    var c = cfg(); if (!c || c.wkey) return;
    S.settings.push.wkey = rnd(); save({ noSnap: true, noCount: true });
  }
  window.widgetCopyScript = function () {
    if (!SCRIPT) { toast("ยังโหลดสคริปต์ไม่เสร็จ ลองอีกครั้ง"); return; }
    var c = cfg();
    copyText(SCRIPT.replace("__KRUTA_URL__", c.url).replace("__KRUTA_KEY__", c.wkey));
  };
  window.widgetCopyCode = function () { copyText(code()); };
  window.widgetNewKey = function () {
    var b = document.getElementById("wg-newkey");
    if (b && !b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "แตะอีกครั้ง — วิดเจ็ตเดิมทุกตัวจะหยุดทำงาน"; return; }
    S.settings.push.wkey = rnd(); save({ noSnap: true, noCount: true }); sync(true);
    toast("สร้างรหัสวิดเจ็ตใหม่แล้ว · ตั้งวิดเจ็ตใหม่ด้วยรหัสนี้"); openWidget();
  };
  function openWidget() {
    var c = cfg(), body;
    if (!c) {
      body = '<div class="warnline">วิดเจ็ตอ่านตารางสอนผ่าน "ตัวส่ง" เดียวกับการแจ้งเตือน — ตั้ง 🔔 แจ้งเตือนคาบถัดไป ก่อน</div>' +
        '<button class="btn-brass" type="button" style="width:100%;" onclick="closeModal();openPush()">ไปตั้งแจ้งเตือน</button>';
    } else {
      ensureKey();
      if (window.__pushLoadWorker) window.__pushLoadWorker();
      if (!SCRIPT) fetch("../widget/scriptable.js").then(function (r) { return r.ok ? r.text() : null; }).then(function (t) { if (t) SCRIPT = t; }).catch(function () {});
      body = '<div id="wg-ver"><div class="hint">กำลังตรวจตัวส่ง…</div></div>' +
        '<details class="more" open><summary>iPad / iPhone — ผ่านแอปฟรี Scriptable</summary><ol class="syguide">' +
          '<li>ติดตั้งแอป <b>Scriptable</b> (ฟรี) จาก App Store</li>' +
          '<li><button class="btn-brass" type="button" style="width:100%;min-height:42px;" onclick="widgetCopyScript()">📋 คัดลอกสคริปต์วิดเจ็ต</button></li>' +
          '<li>เปิด Scriptable › กด <b>+</b> มุมขวาบน › วาง › แตะชื่อด้านบน ตั้งชื่อ <b>ครูต้า</b> › <b>Done</b></li>' +
          '<li>กดค้างที่หน้าจอโฮม › <b>+</b> (หรือ <b>แก้ไข › เพิ่มวิดเจ็ต</b>) › <b>Scriptable</b> › เลือกขนาด › <b>เพิ่มวิดเจ็ต</b></li>' +
          '<li>กดค้างที่วิดเจ็ตที่เพิ่งวาง › <b>แก้ไขวิดเจ็ต</b> › Script = <b>ครูต้า</b></li>' +
          '<li>🎨 เปลี่ยนสี: กดค้างที่วิดเจ็ต › <b>แก้ไขวิดเจ็ต</b> › ช่อง <b>Parameter</b> พิมพ์ <b>ครีม</b> · <b>กลางคืน</b> · <b>ชมพู</b> · <b>ฟ้า</b> · <b>มิ้นต์</b> · <b>ม่วง</b> หรือ <b>ดำ</b> (เว้นว่าง = ตามโหมดของเครื่อง)</li>' +
        '</ol><div class="hint">เล็ก = คาบถัดไป · กลาง = คาบถัดไป + วันนี้ · ใหญ่ = วันนี้ทั้งหมด + พรุ่งนี้</div></details>' +
        '<details class="more" open style="margin-top:10px;"><summary>Samsung / Android — แอปวิดเจ็ตครูต้า</summary><ol class="syguide">' +
          '<li><a class="btn-brass" href="../widget/kruta-widget.apk" download style="display:block;text-align:center;padding:11px;text-decoration:none;">⬇ ดาวน์โหลดแอปวิดเจ็ต (APK)</a></li>' +
          '<li>เปิดไฟล์ที่ดาวน์โหลด › ถ้าขึ้นว่าไม่อนุญาต ให้กด <b>การตั้งค่า</b> › เปิด <b>อนุญาตจากแหล่งนี้</b> › กลับมากด <b>ติดตั้ง</b> (ถ้า Play Protect เตือน เลือก <b>ติดตั้งต่อไป</b>)</li>' +
          '<li><button class="btn-g" type="button" style="width:100%;min-height:42px;" onclick="widgetCopyCode()">📋 คัดลอกรหัสวิดเจ็ต</button></li>' +
          '<li>เปิดแอป <b>ครูต้า วิดเจ็ต</b> › <b>วางจากคลิปบอร์ด</b> › <b>บันทึก</b> › <b>➕ วางวิดเจ็ตบนหน้าจอโฮม</b></li>' +
          '<li>🎨 เปลี่ยนสี: เปิดแอป <b>ครูต้า วิดเจ็ต</b> › <b>สีวิดเจ็ต</b> เลือกได้ 8 แบบ</li>' +
          '<li>มีแอปวิดเจ็ตรุ่นเก่าอยู่แล้ว: ดาวน์โหลดแล้วติดตั้งทับได้เลย ค่าที่ตั้งไว้ไม่หาย</li>' +
        '</ol><div class="hint">แอปนี้ขอสิทธิ์แค่อินเทอร์เน็ต · ปรับขนาดวิดเจ็ตได้ ยิ่งสูงยิ่งเห็นคาบวันนี้มากขึ้น · แตะ ↻ เพื่อโหลดใหม่</div></details>' +
        '<div class="rc-group" style="margin-top:12px;"><label>สถานะ</label><div id="wg-state" class="hint"></div></div>' +
        '<div class="hint" style="margin:8px 0;">รหัสวิดเจ็ตอ่านชื่อนักเรียนและเวลาคาบ 8 วันได้อย่างเดียว · อย่าส่งให้คนอื่น</div>' +
        '<button class="linkbtn" id="wg-newkey" type="button" onclick="widgetNewKey()">สร้างรหัสวิดเจ็ตใหม่ (ถ้ารหัสหลุด)</button>';
    }
    showModal('<div class="mhead"><div class="mtitle">🧩 วิดเจ็ตหน้าจอโฮม</div><button class="ib" type="button" onclick="closeModal()" aria-label="ปิด" style="font-size:19px;">✕</button></div>' + body, "480px");
    if (!c) return;
    var st = function (t) { var e = document.getElementById("wg-state"); if (e) e.innerHTML = t; };
    fetch(c.url + "/").then(function (r) { return r.json(); }).then(function (info) {
      var box = document.getElementById("wg-ver"); if (!box) return;
      if (!(info && info.version >= NEED_VER)) {
        box.innerHTML = '<div class="warnline"><b>ต้องอัปเดตโค้ดตัวส่งก่อน</b> (วิดเจ็ตต้องใช้รุ่น 3)<br>' +
          'Cloudflare › <b>kruta-push</b> › <b>Edit code</b> › Command Palette › <b>Select All</b> › วางโค้ดใหม่ › <b>Deploy</b></div>' +
          '<button class="btn-g" type="button" style="width:100%;min-height:40px;margin-bottom:10px;" onclick="pushCopyWorker()">📋 คัดลอกโค้ดตัวส่งรุ่นใหม่</button>' +
          '<div class="hint" style="margin:-4px 0 10px;">คัดลอกไม่ได้? เปิด <a href="push-worker.js" target="_blank" rel="noopener">ไฟล์โค้ด</a> แล้วเลือกทั้งหมด</div>';
        st("รอตัวส่งรุ่นใหม่");
        return;
      }
      box.innerHTML = "";
      lsj("td_wd_old", null);
      st("กำลังส่งตารางให้วิดเจ็ต…");
      sync(true).then(function (ok) {
        var last = lsj("td_wd_last");
        st(ok || last ? "✓ ส่งตาราง " + lessons().length + " คาบ (8 วัน) ให้วิดเจ็ตแล้ว · อัปเดตเองทุกครั้งที่บันทึก" : "ส่งตารางไม่สำเร็จ — ตรวจเน็ตแล้วเปิดหน้านี้ใหม่");
      });
    }).catch(function () { st("ติดต่อตัวส่งไม่ได้ (ไม่มีเน็ต?)"); });
  }
  window.openWidget = openWidget;

  var origMenu = window.openMenu;
  window.openMenu = function () {
    origMenu.apply(this, arguments);
    var after = document.getElementById("pu-row") || document.getElementById("th-row");
    if (!after) return;
    var b = document.createElement("button");
    b.className = "srow"; b.type = "button"; b.id = "wg-row"; b.style.marginBottom = "8px";
    b.innerHTML = '<span style="font-size:18px;flex-shrink:0;">🧩</span><div style="min-width:0;"><div style="font-weight:600;">วิดเจ็ตหน้าจอโฮม</div>' +
      '<div style="font-size:11px;color:#5A5A5A;margin-top:2px;">คาบถัดไป + คาบวันนี้ บน iPad และ Samsung</div></div>';
    b.addEventListener("click", function () { closeModal(); openWidget(); });
    after.parentNode.insertBefore(b, after.nextSibling);
  };

  window.__widgetLessons = lessons;
  window.__widgetSync = sync;
  window.__widget = "on";
})();
