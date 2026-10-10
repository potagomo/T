/* ชั้นเว็บแอป: เรียก "น้อง" หน้าชื่อนักเรียนในของที่ส่งผู้ปกครอง — tools/update-lesson.py ฝังไฟล์นี้ไว้ท้าย lesson/index.html

   รูปการ์ด ข้อความ LINE แฟ้มสะสมผลงาน และข้อความแนบคลิป เขียนชื่อห้วน ๆ ("มายด์ เรียนวันนี้…")
   ชั้นนี้เติม "น้อง" ให้เฉพาะของที่ส่งออก ("น้องมายด์" · ชื่ออังกฤษเว้นวรรค "น้อง Harvey")
   ในแอป รายงานส่งโรงเรียน และข้อมูลที่เก็บไว้ยังเป็นชื่อเดิม · ชื่อที่ขึ้นต้นด้วย "น้อง" อยู่แล้วไม่เติมซ้ำ
   แม่แบบที่ครูพิมพ์ "น้อง{ชื่อ}" ไว้เองก็ไม่ซ้ำ · ปิดได้ที่ ⚙ › ส่งผู้ปกครองและหน้าตา › เรียก “น้อง” หน้าชื่อนักเรียน */
(function () {
  "use strict";
  if (typeof window.displayName !== "function" || typeof window.fillTokens !== "function") { window.__nong = "missing"; return; }
  function on() { return !(window.S && S.settings && S.settings.nong === false); }
  var THAI = /^[ก-ฺเ-๛]/;
  function nong(name) {
    name = String(name == null ? "" : name).trim();
    if (!name || !on() || /^น้อง/.test(name)) return name;
    return THAI.test(name) ? "น้อง" + name : "น้อง " + name;
  }
  window.__nongName = nong;

  // ระหว่างวาด/เขียนของที่ส่งผู้ปกครอง displayName() คืนชื่อพร้อม "น้อง" (ทุกตัวเป็นฟังก์ชันวาดแบบทำทีเดียวจบ)
  var depth = 0;
  var origName = window.displayName;
  window.displayName = function () {
    var n = origName.apply(this, arguments);
    return depth > 0 ? nong(n) : n;
  };
  var origFill = window.fillTokens;
  window.fillTokens = function (t) {
    var args = Array.prototype.slice.call(arguments);
    if (depth > 0 && on()) args[0] = String(t || "").replace(/น้อง\s*\{ชื่อ\}/g, "{ชื่อ}");
    return origFill.apply(this, args);
  };
  ["layoutCard", "layoutPortfolio", "shareText"].forEach(function (fn) {
    var orig = window[fn];
    if (typeof orig !== "function") return;
    window[fn] = function () {
      depth++;
      try { return orig.apply(this, arguments); } finally { depth--; }
    };
  });

  // แถวในหน้าตั้งค่า (หมวด "ส่งผู้ปกครองและหน้าตา")
  if (typeof window.openMenu === "function") {
    var origMenu = window.openMenu;
    window.openMenu = function () {
      var r = origMenu.apply(this, arguments);
      var anchor = document.getElementById("lang-row") || document.querySelector('#modal-root button.srow[onclick="lockApp()"]');
      if (anchor && !document.getElementById("nong-row")) {
        var b = document.createElement("button");
        b.className = "srow"; b.type = "button"; b.id = "nong-row"; b.style.marginBottom = "8px";
        var paint = function () {
          b.innerHTML = '<span style="font-size:18px;flex-shrink:0;">🧒</span><div style="min-width:0;"><div style="font-weight:600;">เรียก “น้อง” หน้าชื่อนักเรียน</div>' +
            '<div style="font-size:11px;color:#5A5A5A;margin-top:2px;">' + (on() ? "เปิด — ส่งผู้ปกครองเป็น “น้องมายด์”" : "ปิด — ส่งผู้ปกครองเป็น “มายด์”") + '</div></div>';
        };
        paint();
        b.addEventListener("click", function () {
          S.settings.nong = !on();
          save();
          if (window.RC) { RC.cache = {}; }
          paint();
          toast(on() ? "ของที่ส่งผู้ปกครองเรียก “น้อง…” แล้ว" : "เลิกเติม “น้อง” หน้าชื่อแล้ว");
        });
        anchor.parentNode.insertBefore(b, anchor.nextSibling);
      }
      return r;
    };
  }
  window.__nong = "on";
})();
