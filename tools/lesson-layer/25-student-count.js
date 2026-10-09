/* ชั้นเว็บแอป: รายชื่อนักเรียนนับเฉพาะคาบที่มาเรียน — tools/update-lesson.py ฝังไฟล์นี้ไว้ท้าย lesson/index.html

   เดิมแท็บ นักเรียน › รายคน เขียนว่า "สอนแล้ว N คาบ" โดยนับทุกคาบในบันทึก รวมคาบที่ยังรอยืนยันและคาบที่ลา
   ชั้นนี้เปลี่ยนเป็น "มาเรียน N ครั้ง" นับเฉพาะคาบที่ยืนยันว่ามาเรียน (attendance = present)
   นักเรียนที่มีคอร์ส/จำนวนครั้งเรียน ยังโชว์ "เหลืออีก N ครั้ง" แบบเดิม */
(function () {
  "use strict";
  if (typeof window.peopleRowsHtml !== "function" || typeof window.studentSummary !== "function" || typeof window.attInfo !== "function") {
    window.__studentCount = "missing";
    return;
  }
  function attended(name) {
    return S.lessons.filter(function (l) { return l.student === name && attInfo(l.attendance) === ATT.present; }).length;
  }
  var inRows = false, origSummary = window.studentSummary, origRows = window.peopleRowsHtml;
  window.studentSummary = function (name) {
    var r = origSummary.apply(this, arguments);
    if (!inRows || !r) return r;
    return Object.assign({}, r, { totalEver: attended(name) });
  };
  window.peopleRowsHtml = function () {
    inRows = true;
    try { return origRows.apply(this, arguments).replace(/สอนแล้ว (\d+) คาบ/g, "มาเรียน $1 ครั้ง"); }
    finally { inRows = false; }
  };
  window.__studentCount = "on";
})();
