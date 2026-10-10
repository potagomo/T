/* ชั้นเว็บแอป: หน้ารายได้เปิดที่เดือน/ปีปัจจุบัน — tools/update-lesson.py ฝังไฟล์นี้ไว้ท้าย lesson/index.html

   เดิมหน้ารายได้เลือก "เดือนล่าสุดที่มีคาบ" ซึ่งรวมคาบรอยืนยันที่ตารางประจำลงล่วงหน้าไว้
   จึงมักเปิดเดือนหน้า (รายได้ ฿0) แทนเดือนนี้
   ชั้นนี้: เข้าแท็บรายได้ทุกครั้ง (และเปิดแอปใหม่) เริ่มที่เดือน/ปีปัจจุบัน
   ถ้าเดือนนี้ไม่มีคาบเลย ใช้เดือนล่าสุดที่ผ่านมาแล้ว · กด ‹ › เลื่อนเดือนได้ตามเดิม */
(function () {
  "use strict";
  if (typeof window.renderMoneyView !== "function" || typeof window.allPeriodKeys !== "function") { window.__moneyNow = "missing"; return; }
  function nowKey(mode) { return mode === "month" ? localISO().slice(0, 7) : String(new Date().getFullYear()); }
  function pick(mode) {
    var periods = allPeriodKeys(mode), cur = nowKey(mode);          // เรียงใหม่ → เก่า
    if (periods.indexOf(cur) >= 0) return cur;
    var past = periods.filter(function (k) { return k <= cur; })[0];
    return past || periods[periods.length - 1];
  }
  var origRender = window.renderMoneyView;
  window.renderMoneyView = function () {
    var periods = allPeriodKeys(S.sum.mode);
    if (!S.sum.period || periods.indexOf(S.sum.period) < 0) S.sum.period = pick(S.sum.mode);
    return origRender.apply(this, arguments);
  };
  var origTab = window.setTab;
  window.setTab = function (t) {
    if (t === "money" && S.tab !== "money") S.sum.period = null;    // เข้ามาใหม่ = เริ่มที่เดือนนี้
    return origTab.apply(this, arguments);
  };
  var origStart = window.startApp;
  // startApp โหลดข้อมูลที่บันทึกไว้ (รวมเดือนที่เคยดู) ก่อน แล้วค่อยวาดหน้า — ล้างหลังโหลด
  window.startApp = function () { var r = origStart.apply(this, arguments); if (S && S.sum) S.sum.period = null; return r; };
  window.__moneyNow = "on";
})();
