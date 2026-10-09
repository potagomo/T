/* ชั้นเว็บแอป: ปุ่ม "ดูคาบนี้" ในหน้านักเรียน เปิดคาบนั้นทันที — tools/update-lesson.py ฝังไฟล์นี้ไว้ท้าย lesson/index.html

   เดิมปุ่ม "ดูคาบนี้" (ประวัติการสอนในหน้านักเรียน) ปิดหน้านักเรียนแล้วพาไปแท็บ นักเรียน › บันทึก
   กางคาบนั้นไว้กลางรายการยาว ๆ โดยไม่เลื่อนไปหา — ผู้ใช้เลยเห็นแค่หน้ารวมและหลงทาง
   ชั้นนี้เปิดการ์ดคาบนั้นแบบกางรายละเอียด ซ้อนบนหน้านักเรียน ปิดแล้วกลับมาหน้านักเรียนที่เดิม
   ปุ่มในการ์ด (ส่งผู้ปกครอง · ⋯ · ชื่อนักเรียน) ทำงานตามเดิม · ติ๊กการบ้านแล้วการ์ดอัปเดตทันที */
(function () {
  "use strict";
  if (typeof window.cardHtml !== "function") { window.__lessonView = "missing"; return; }
  var box = null, curId = null;

  function close() {
    if (box && box.parentNode) box.parentNode.removeChild(box);
    box = null; curId = null;
    document.removeEventListener("keydown", onKey, true);
  }
  function onKey(e) { if (e.key === "Escape" && box) { e.stopPropagation(); close(); } }
  function render() {
    var l = S.lessons.find(function (x) { return x.id === curId; });
    if (!l) { close(); toast("ไม่พบคาบนี้ (อาจถูกลบไปแล้ว)"); return; }
    var keep = S.expanded; S.expanded = l.id;
    var html; try { html = cardHtml(l); } finally { S.expanded = keep; }
    box.firstChild.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;">' +
        '<button class="btn-g" type="button" data-lv-close style="min-height:40px;padding:6px 12px;">‹ กลับหน้านักเรียน</button>' +
        '<button class="ib" type="button" data-lv-close aria-label="ปิด" style="font-size:19px;">✕</button></div>' +
      '<div class="lv-card">' + html + '</div>';
    // ในหน้านี้กางไว้เสมอ ไม่ให้แตะแล้วพับ (ตัวพับของแอปเดิมวาดรายการหลักใหม่ ไม่ใช่การ์ดนี้)
    Array.prototype.forEach.call(box.querySelectorAll('[onclick^="toggleExp("]'), function (el) { el.removeAttribute("onclick"); el.style.cursor = "default"; });
    // ลูกศรพับ/กาง (▲▼) ใช้ไม่ได้ในหน้านี้ ซ่อนไว้
    Array.prototype.forEach.call(box.querySelectorAll(".lv-card *"), function (el) {
      if (el.children.length === 0 && /^[▲▼]$/.test((el.textContent || "").trim())) el.style.visibility = "hidden";
    });
  }
  function viewLesson(id) {
    close();
    curId = id;
    box = document.createElement("div");
    box.className = "overlay"; box.id = "lesson-view";
    // ขอบบาง ให้การ์ดกว้างเท่าในรายการปกติ (ขอบหนาของหน้าต่างทำให้คอลัมน์กลางแคบจนตัดบรรทัดทีละคำ)
    box.style.cssText = "z-index:1150;display:flex;align-items:flex-start;justify-content:center;padding:10px 6px;overflow:auto;";
    box.innerHTML = '<div class="modal-box" role="dialog" aria-modal="true" style="max-width:600px;width:100%;margin:auto 0;padding:12px 10px;"></div>';
    document.body.appendChild(box);
    render();
    if (!box) return;
    box.addEventListener("click", function (e) {
      if (e.target === box || (e.target.closest && e.target.closest("[data-lv-close]"))) { close(); return; }
      var act = e.target.closest && e.target.closest("[onclick]");
      if (!act) return;
      // ปุ่มที่เปิดหน้าอื่น (ส่งผู้ปกครอง ⋯ ชื่อนักเรียน) → ปิดหน้านี้ · ปุ่มที่แค่แก้ข้อมูล (สถานะ ติ๊กการบ้าน) → วาดการ์ดใหม่
      var modalBefore = document.getElementById("modal-box"), tabBefore = S.tab;
      setTimeout(function () {
        if (!box) return;
        if (document.getElementById("modal-box") !== modalBefore || S.tab !== tabBefore || document.querySelector(".overlay:not(#lesson-view):not(#modal-bg)")) close();
        else render();
      }, 0);
    });
    document.addEventListener("keydown", onKey, true);
  }
  window.viewLesson = viewLesson;

  // ดักปุ่ม "ดูคาบนี้" ของแอปเดิม (onclick="closeModal();setTab('students');...S.expanded=ID;renderLessonsView();")
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest && e.target.closest("button[onclick]");
    if (!b) return;
    var m = /S\.expanded=(\d+);renderLessonsView\(\)/.exec(b.getAttribute("onclick") || "");
    if (!m || !/setSub\('students','log'\)/.test(b.getAttribute("onclick"))) return;
    e.preventDefault(); e.stopPropagation();
    viewLesson(Number(m[1]));
  }, true);
  window.__lessonView = "on";
})();
