/* ชั้นเว็บแอป: เลิกเตือนสำรองไฟล์ทุกวันเมื่อซิงค์คลาวด์อยู่แล้ว — tools/update-lesson.py ฝังไฟล์นี้ไว้ท้าย lesson/index.html

   เดิมหน้า วันนี้ ขึ้นแถบ "ยังไม่เคยสำรองข้อมูลเป็นไฟล์" ทุกวัน (เกิน 7 วันก็เตือน) แม้ข้อมูลซิงค์ขึ้น Firebase
   ทุกครั้งที่บันทึก และแอปเก็บประวัติย้อนหลังอัตโนมัติ 30 วันอยู่แล้ว
   ชั้นนี้: ถ้าซิงค์คลาวด์ทำงานปกติ (ได้ข้อมูลจากคลาวด์ภายใน 3 วัน) เตือนสำรองไฟล์เฉพาะเมื่อไม่ได้สำรองเกิน 30 วัน
   ยังไม่เคยสำรองเลยก็ไม่เตือนบนหน้าแรก (เมนู ⚙ › ข้อมูล ยังบอกสถานะเสมอ) · ซิงค์ไม่ทำงาน = เตือนแบบเดิม */
(function () {
  "use strict";
  if (typeof window.renderBanner !== "function" || typeof window.daysBetween !== "function") { window.__calmBackup = "missing"; return; }
  var CLOUD_DAYS = 30;
  function cloudOk() {
    try { return !!(SY && SY.user && SY.st && SY.st.cfg && SY.st.lastOk && Date.now() - SY.st.lastOk < 3 * 86400000); }
    catch (e) { return false; }
  }
  var orig = window.renderBanner;
  window.renderBanner = function () {
    var d = daysBetween(S.settings.lastBackup);
    if (!cloudOk() || (d !== null && d >= CLOUD_DAYS)) return orig.apply(this, arguments);
    // ปิดเฉพาะแถบสำรอง (แถบ "มีคาบที่กรอกค้าง" ยังขึ้นตามเดิม) โดยไม่แตะค่าที่บันทึกไว้
    var keep = S.settings.backupSnoozeUntil;
    S.settings.backupSnoozeUntil = Date.now() + 60000;
    try { return orig.apply(this, arguments); }
    finally { if (keep === undefined) delete S.settings.backupSnoozeUntil; else S.settings.backupSnoozeUntil = keep; }
  };
  // หน้าตั้งค่าใช้ตัดสินว่าจะขึ้นจุดเตือนที่หมวดข้อมูลไหม (ให้ตรงกับแถบบนหน้าแรก)
  window.__backupQuiet = function () { var d = daysBetween(S.settings.lastBackup); return cloudOk() && (d === null || d < CLOUD_DAYS); };
  window.__calmBackup = "on";
})();
