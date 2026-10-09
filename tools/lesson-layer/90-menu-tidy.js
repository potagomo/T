/* ชั้นเว็บแอป: จัดหน้าตั้งค่าให้เป็นหมวด กระชับ — tools/update-lesson.py ฝังไฟล์นี้ไว้ท้าย lesson/index.html
   ต้องเป็นชั้นสุดท้ายที่ห่อ openMenu (เลข 90) เพราะชั้นอื่นเติมแถวของตัวเองเข้าไปก่อน

   เดิม 22 แถวสูงเต็มบรรทัด กองอยู่ 3 หมวด (หมวด "ข้อมูลของคุณ" มี 12 แถวปนกันทั้งการตั้งเครื่องและการดูแลข้อมูล)
   บนมือถือเลื่อนยาว ~6000 px · ชั้นนี้ย้ายแถวเดิม (ตัวปุ่มเดิม ไม่สร้างใหม่) เข้าหมวดตามงาน
   แถวเตี้ยลง คำอธิบายบรรทัดเดียว · iPad แสดง 2 คอลัมน์ · "รีเซ็ตแอป" แยกไว้ล่างสุด
   แถวที่ไม่รู้จัก (เช่นมาจากรุ่นใหม่ของแอป) ไปอยู่หมวด "อื่น ๆ" ไม่หาย */
(function () {
  "use strict";
  if (typeof window.openMenu !== "function") { window.__menuTidy = "missing"; return; }

  var GROUPS = [
    ["การสอน", ["ชื่อผู้สอน", "สถานที่สอน", "ตารางประจำสัปดาห์", "วางตารางจากไลน์", "การ์ดแจ้งวันหยุด"]],
    ["ส่งผู้ปกครอง · หน้าตา", ["หน้าตาการส่งออก", "ลูกเล่นและความรู้สึก", "โหมดกลางคืน"]],
    ["เครื่องนี้ · การเชื่อมต่อ", ["ซิงค์", "แจ้งเตือนคาบถัดไป", "วิดเจ็ตหน้าจอโฮม", "ติดตั้งเป็นแอป"]],
    ["ข้อมูล", ["สำรอง", "ประวัติย้อนหลัง", "ถังขยะ", "สุขภาพข้อมูล", "ตรวจประเภทคาบ"]],
    ["ความปลอดภัย", ["ปลดล็อกด้วย", "เปลี่ยนรหัสผ่าน", "รหัสกู้คืน", "ล็อกหน้าจอ"]],
    ["ล้างข้อมูล", ["รีเซ็ตแอป"]]
  ];

  var css = document.createElement("style");
  css.textContent =
    "#modal-root .mt-title{margin:16px 0 8px;}" +
    "#modal-root .mt-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;}" +
    "#modal-root .mt-grid .srow{margin:0 !important;padding:10px 12px;min-height:50px;}" +
    "#modal-root .mt-grid .srow > div{flex:1;min-width:0;}" +
    "#modal-root .mt-grid .srow > div > div + div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
    "#modal-root .mt-danger{margin-top:22px;padding-top:6px;border-top:1px dashed rgba(0,0,0,0.35);}" +
    "@media (min-width:720px){#modal-root .mt-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr);}}";
  document.head.appendChild(css);

  function titleOf(row) {
    var t = row.querySelector("div > div");
    return (t ? t.textContent : row.textContent).trim();
  }
  function tidy() {
    var box = document.getElementById("modal-box");
    if (!box || box.querySelector(".mt-grid")) return;
    var rows = Array.prototype.slice.call(box.querySelectorAll(".srow"));
    if (rows.length < 8) return;                                   // ไม่ใช่หน้าตั้งค่า
    var head = box.firstElementChild;
    var buckets = GROUPS.map(function () { return []; }), rest = [];
    rows.forEach(function (r) {
      var t = titleOf(r), gi = -1;
      GROUPS.some(function (g, i) { if (g[1].some(function (k) { return t.indexOf(k) === 0; })) { gi = i; return true; } return false; });
      if (gi < 0) rest.push(r); else buckets[gi].push(r);
    });
    // เรียงในหมวดตามลำดับที่กำหนด ไม่ใช่ลำดับที่ชั้นต่าง ๆ เติมเข้ามา
    buckets.forEach(function (b, i) {
      var keys = GROUPS[i][1];
      b.sort(function (x, y) {
        var ix = keys.findIndex(function (k) { return titleOf(x).indexOf(k) === 0; }), iy = keys.findIndex(function (k) { return titleOf(y).indexOf(k) === 0; });
        return ix - iy;
      });
    });
    var wrap = document.createElement("div"); wrap.className = "mt";
    function section(title, list, danger) {
      if (!list.length) return;
      var sec = document.createElement("div"); if (danger) sec.className = "mt-danger";
      var h = document.createElement("div"); h.className = "statlabel mt-title"; h.textContent = title;
      var g = document.createElement("div"); g.className = "mt-grid";
      list.forEach(function (r) { g.appendChild(r); });
      sec.appendChild(h); sec.appendChild(g); wrap.appendChild(sec);
    }
    GROUPS.forEach(function (g, i) { if (i < GROUPS.length - 1) section(g[0], buckets[i]); });
    section("อื่น ๆ", rest);
    section(GROUPS[GROUPS.length - 1][0], buckets[GROUPS.length - 1], true);
    // ลบแค่หัวข้อหมวดเดิม (ส่วนอื่นที่อาจมีในหน้าตั้งค่ายังอยู่ครบ) แล้ววางชุดใหม่ต่อจากหัว "ตั้งค่า"
    Array.prototype.slice.call(box.querySelectorAll(".statlabel:not(.mt-title)")).forEach(function (c) { if (c.parentNode) c.parentNode.removeChild(c); });
    box.insertBefore(wrap, head.nextSibling);
    if (window.innerWidth >= 720) box.style.maxWidth = "760px";
  }

  var orig = window.openMenu;
  window.openMenu = function () {
    var r = orig.apply(this, arguments);
    try { tidy(); } catch (e) {}
    return r;
  };
  window.__menuTidy = "on";
})();
