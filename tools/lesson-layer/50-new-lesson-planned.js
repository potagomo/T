/* ชั้นเว็บแอป: คาบที่กด + เพิ่มเอง เริ่มเป็น "รอยืนยัน" — tools/update-lesson.py ฝังไฟล์นี้ไว้ท้าย lesson/index.html

   เดิม openAdd() ตั้งสถานะคาบใหม่เป็น "มาเรียน" ทันที ต่างจากคาบที่มาจากตารางประจำ/ไลน์ที่เป็น "รอยืนยัน"
   ครูอยากให้เหมือนกันหมด แล้วค่อยยืนยันทีหลัง (ปัดการ์ด / ยืนยันทั้งหมด / เปลี่ยนในฟอร์ม)
   แตะเฉพาะคาบใหม่ — การแก้คาบเดิมไม่เปลี่ยนสถานะ */
(function () {
  "use strict";
  if (typeof window.openAdd !== "function" || typeof window.showLessonModal !== "function" || !window.ATT || !ATT.planned) {
    window.__newPlanned = "missing";
    return;
  }
  var origAdd = window.openAdd;
  window.openAdd = function () {
    var origShow = window.showLessonModal;
    // openAdd สร้าง EF แล้วเรียก showLessonModal() — แทรกตรงกลางเพื่อเปลี่ยนค่าเริ่มต้นก่อนวาดฟอร์ม
    window.showLessonModal = function () {
      window.showLessonModal = origShow;
      if (window.EF && EF._mode === "add" && EF.attendance === "present") {
        EF.attendance = "planned";
        LESSON_BASE = JSON.stringify(EF);       // ไม่นับเป็น "มีการแก้ที่ยังไม่บันทึก"
      }
      return origShow.apply(this, arguments);
    };
    try { return origAdd.apply(this, arguments); }
    finally { window.showLessonModal = origShow; }
  };
  // ปุ่มสถานะในฟอร์ม: เดิมปุ่ม "ยังไม่ยืนยัน" หายไปทันทีที่เลือกอย่างอื่น — คาบใหม่จึงสลับกลับไม่ได้
  // ให้คาบใหม่มีปุ่มนี้ตลอด (หน้าตาเหมือนเดิมทุกอย่าง)
  if (typeof window.efAttHtml === "function") {
    var origAtt = window.efAttHtml;
    window.efAttHtml = function () {
      if (!(window.EF && EF._mode === "add") || EF.attendance === "planned") return origAtt.apply(this, arguments);
      var cur = EF.attendance || "present";
      EF.attendance = "planned";                       // ให้ตัวเดิมวาดชุดที่มีปุ่ม "ยังไม่ยืนยัน"
      var html = origAtt.apply(this, arguments);
      EF.attendance = cur;
      // แล้วย้ายไฮไลต์กลับไปที่ปุ่มที่เลือกจริง
      var box = document.createElement("div"); box.innerHTML = html;
      Array.prototype.forEach.call(box.querySelectorAll("button"), function (b) {
        var k = (b.getAttribute("onclick") || "").replace(/^efSetAtt\('|'\)$/g, ""), info = ATT[k], on = k === cur;
        if (!info) return;
        b.setAttribute("aria-pressed", String(on));
        b.style.borderColor = on ? info.color : "#000000";
        b.style.background = on ? "var(--yel)" : "transparent";
        b.style.color = on ? info.color : "#5A5A5A";
      });
      return box.innerHTML;
    };
  }
  window.__newPlanned = "on";
})();
