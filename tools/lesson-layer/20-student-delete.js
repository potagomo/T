/* ชั้นเว็บแอป: ลบนักเรียนออกจากรายชื่อ — tools/update-lesson.py ฝังไฟล์นี้ไว้ท้าย lesson/index.html

   เดิมหน้า "ข้อมูลนักเรียน" ซ่อนปุ่มลบเงียบ ๆ ถ้ายังมีอะไรผูกกับชื่อนี้ (คาบ ตารางประจำ คอร์ส
   จำนวนครั้งเรียน หรือของในถังขยะของเครื่องนี้) ครูจึงหาปุ่มไม่เจอและไม่รู้ว่าติดอะไร
   ชั้นนี้บอกว่าติดอะไรบ้าง และถ้าไม่มีคาบที่สอนจริงหรือคอร์สเลย (เหลือแต่ของค้าง) ก็ล้างให้ในแตะเดียว
   คาบที่สอนแล้วไม่ลบให้เด็ดขาด · คอร์สมีปุ่มลบแยกทีละคอร์สในกล่องนี้ (ย้ายไปถังขยะ กู้คืนได้) */
(function () {
  "use strict";
  var NEED = ["showStudentProfile", "studentRecordCount", "save", "closeModal", "toast", "esc", "trashCourse", "lessonsOfCourse", "openStudentProfile"];
  for (var i = 0; i < NEED.length; i++) if (typeof window[NEED[i]] !== "function") {
    window.__studentDelete = "missing:" + NEED[i];
    return;
  }

  function refs(key) {
    var mine = function (x) { return x && x.student === key; };
    var L = S.lessons.filter(mine);
    return {
      taught: L.filter(function (l) { return l.attendance !== "planned"; }).length,
      planned: L.filter(function (l) { return l.attendance === "planned"; }).length,
      courses: S.courses.filter(mine).length,
      schedule: S.schedule.filter(mine).length,
      enroll: S.enrollments.filter(mine).length,
      trash: S.trash.filter(function (t) { return t && mine(t.data); }).length
    };
  }
  // คอร์สลบได้จากตรงนี้เลย (แอปเดิมมีฟังก์ชันลบคอร์ส แต่ไม่มีปุ่มให้กดที่ไหน)
  function courseRows(key) {
    var cs = S.courses.filter(function (c) { return c.student === key; });
    if (!cs.length) return "";
    return cs.map(function (c) {
      var n = lessonsOfCourse(c.id).length;
      return "<div style=\"display:flex;align-items:center;gap:8px;margin-top:8px;\"><div style=\"flex:1;min-width:0;\">📦 <b>" +
        esc(c.name || "ไม่มีชื่อ") + "</b>" + (n ? " · ผูกอยู่ " + n + " คาบ (คาบไม่ถูกลบ)" : "") + "</div>" +
        "<button class=\"btn-d\" type=\"button\" data-course=\"" + c.id + "\" style=\"min-height:40px;padding:6px 12px;flex-shrink:0;\">ลบคอร์ส</button></div>";
    }).join("");
  }
  function line(n, label) { return n ? "<li>" + label + " " + n + " รายการ</li>" : ""; }

  var orig = window.showStudentProfile;
  window.showStudentProfile = function () {
    orig.apply(this, arguments);
    if (!PF2 || PF2.mode === "add" || !studentRecordCount(PF2.key)) return;
    var foot = document.querySelector("#modal-root .modal-foot");
    if (!foot) return;
    var r = refs(PF2.key), real = r.taught + r.courses;
    var box = document.createElement("div");
    box.className = "hint";
    box.id = "sd-box";
    box.style.cssText = "margin-top:16px;padding:12px;border:2px solid #000;background:#FFF7D6;line-height:1.7;";
    box.innerHTML =
      "<b>ยังลบชื่อนี้ไม่ได้</b> เพราะยังมีของผูกอยู่:<ul style=\"margin:6px 0 0 20px;\">" +
      line(r.taught, "คาบที่สอนแล้ว") + line(r.planned, "คาบที่วางแผนไว้ (ยังไม่สอน)") +
      line(r.schedule, "ตารางสอนประจำสัปดาห์") + line(r.courses, "คอร์ส") +
      line(r.enroll, "จำนวนครั้งเรียน") + line(r.trash, "ในถังขยะของเครื่องนี้") + "</ul>" +
      courseRows(PF2.key) +
      (real
        ? (r.taught ? "<div style=\"margin-top:8px;\">คาบที่สอนแล้วต้องลบเองก่อน (แท็บ นักเรียน › บันทึก แล้วค้นชื่อ) " +
          "แล้วค่อยกลับมาที่หน้านี้</div>" : "")
        : "<div style=\"margin-top:8px;\">ไม่มีคาบที่สอนจริงหรือคอร์สเลย ล้างของที่ค้างแล้วลบชื่อได้ในแตะเดียว</div>" +
          "<button class=\"btn-d\" type=\"button\" id=\"sd-go\" style=\"width:100%;margin-top:10px;\">ล้างของที่ค้างและลบนักเรียนคนนี้</button>");
    foot.parentNode.insertBefore(box, foot);
    Array.prototype.forEach.call(box.querySelectorAll("[data-course]"), function (b) {
      b.addEventListener("click", function () {
        if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "แตะอีกครั้งเพื่อลบคอร์สนี้"; return; }
        var key = PF2.key;
        if (trashCourse(Number(b.dataset.course))) { toast("ย้ายคอร์สไปถังขยะแล้ว"); openStudentProfile(key); }
      });
    });
    var go = document.getElementById("sd-go");
    if (go) go.addEventListener("click", function () {
      if (!go.dataset.armed) { go.dataset.armed = "1"; go.textContent = "แตะอีกครั้งเพื่อยืนยันการลบ"; return; }
      purgeStudent(PF2.key);
    });
  };

  function purgeStudent(key) {
    var r = refs(key);
    if (r.taught || r.courses) { toast("ยังมีคาบที่สอนแล้วหรือคอร์สอยู่ ลบให้ไม่ได้"); return; }
    var mine = function (x) { return x && x.student === key; };
    var not = function (x) { return !mine(x); };
    // คาบที่วางแผนไว้ลบจาก S.lessons ตรง ๆ — อีกเครื่องจะได้รับเป็นการลบตามปกติของการซิงค์
    S.lessons = S.lessons.filter(not);
    S.schedule = S.schedule.filter(not);
    S.enrollments = S.enrollments.filter(not);
    S.trash = S.trash.filter(function (t) { return !(t && mine(t.data)); });
    S.students = S.students.filter(function (s) { return s.key !== key; });
    if (save({ allowDrop: true })) {
      closeModal();
      try { renderAll(); } catch (e) {}
      toast("ลบนักเรียนออกจากรายชื่อแล้ว");
    }
  }
  window.purgeStudent = purgeStudent;
  window.__studentDelete = "on";
})();
