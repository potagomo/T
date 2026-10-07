/* ชั้นเว็บแอป: ปุ่มแก้ไข/ลบคอร์ส — tools/update-lesson.py ฝังไฟล์นี้ไว้ท้าย lesson/index.html

   แอปเดิมมี openEditCourse() กับ confirmDelCourse() ครบ แต่ปุ่มของมันอยู่ในการ์ดคอร์ส
   (courseCardHtml) ที่ไม่มีหน้าไหนเรียกใช้แล้ว คอร์สจึงแก้หรือลบไม่ได้เลย
   ชั้นนี้เติมปุ่มสองอันใต้การ์ดคอร์สแต่ละใบในหน้าประวัตินักเรียน */
(function () {
  "use strict";
  var NEED = ["showStudentModal", "openEditCourse", "confirmDelCourse", "coursesOf"];
  for (var i = 0; i < NEED.length; i++) if (typeof window[NEED[i]] !== "function") {
    window.__courseActions = "missing:" + NEED[i];
    return;
  }
  var orig = window.showStudentModal;
  window.showStudentModal = function () {
    orig.apply(this, arguments);
    var name = window.HIST && HIST.student;
    if (!name) return;
    var cs = coursesOf(name);
    if (!cs.length) return;
    // การ์ดคอร์สเรียงตาม coursesOf() — จับคู่ตามลำดับและชื่อคอร์ส
    var cards = Array.prototype.filter.call(document.querySelectorAll("#modal-root .card"), function (el) {
      return el.firstElementChild && cs.some(function (c) { return el.firstElementChild.textContent === (c.name || ""); });
    });
    var used = 0;
    cs.forEach(function (c) {
      var card = null;
      for (var k = used; k < cards.length; k++) if (cards[k].firstElementChild.textContent === (c.name || "")) { card = cards[k]; used = k + 1; break; }
      if (!card || card.querySelector(".ca-row")) return;
      var row = document.createElement("div");
      row.className = "ca-row";
      row.style.cssText = "display:flex;gap:8px;margin-top:10px;";
      row.innerHTML = '<button class="btn-g" type="button" style="flex:1;min-height:40px;padding:6px 10px;font-size:13px;">✎ แก้ไขคอร์ส</button>' +
        '<button class="btn-g" type="button" style="flex:1;min-height:40px;padding:6px 10px;font-size:13px;color:#B91C1C;">ลบคอร์ส</button>';
      row.children[0].addEventListener("click", function () { openEditCourse(c.id); });
      row.children[1].addEventListener("click", function () { confirmDelCourse(c.id); });
      card.appendChild(row);
    });
  };
  window.__courseActions = "on";
})();
