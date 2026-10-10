/* ชั้นเว็บแอป: จัดหน้าตั้งค่าให้เป็นหมวด กระชับ — tools/update-lesson.py ฝังไฟล์นี้ไว้ท้าย lesson/index.html
   ต้องเป็นชั้นสุดท้ายที่ห่อ openMenu (เลข 90) เพราะชั้นอื่นเติมแถวของตัวเองเข้าไปก่อน

   หมวดพับไว้ เห็นแค่หัวข้อ แตะแล้วกาง (ทีละหมวด จำหมวดที่เปิดล่าสุด) · เดิม 22 แถวสูงเต็มบรรทัด กองอยู่ 3 หมวด (หมวด "ข้อมูลของคุณ" มี 12 แถวปนกันทั้งการตั้งเครื่องและการดูแลข้อมูล)
   บนมือถือเลื่อนยาว ~6000 px · ชั้นนี้ย้ายแถวเดิม (ตัวปุ่มเดิม ไม่สร้างใหม่) เข้าหมวดตามงาน
   แถวเตี้ยลง คำอธิบายบรรทัดเดียว · iPad แสดง 2 คอลัมน์ · "รีเซ็ตแอป" แยกไว้ล่างสุด
   แถวที่ไม่รู้จัก (เช่นมาจากรุ่นใหม่ของแอป) ไปอยู่หมวด "อื่น ๆ" ไม่หาย */
(function () {
  "use strict";
  if (typeof window.openMenu !== "function") { window.__menuTidy = "missing"; return; }

  // [ชื่อหมวด, ไอคอน, คำขึ้นต้นของแถวในหมวด (เรียงตามนี้)]
  var GROUPS = [
    ["การสอน", "🥁", ["ชื่อผู้สอน", "สถานที่สอน", "ตารางประจำสัปดาห์", "วางตารางจากไลน์", "งานสำคัญ", "การ์ดแจ้งวันหยุด"]],
    ["ส่งผู้ปกครองและหน้าตา", "🎨", ["หน้าตาการส่งออก", "ลูกเล่นและความรู้สึก", "โหมดกลางคืน", "ภาษา", "เรียก “น้อง”"]],
    ["เครื่องนี้และการเชื่อมต่อ", "📱", ["ซิงค์", "แจ้งเตือนคาบถัดไป", "วิดเจ็ตหน้าจอโฮม", "ติดตั้งเป็นแอป"]],
    ["ข้อมูลและการสำรอง", "💾", ["สำรอง", "ประวัติย้อนหลัง", "ถังขยะ", "สุขภาพข้อมูล", "ตรวจประเภทคาบ"]],
    ["ความปลอดภัย", "🔒", ["ปลดล็อกด้วย", "เปลี่ยนรหัสผ่าน", "รหัสกู้คืน", "ล็อกหน้าจอ"]],
    ["ล้างข้อมูล", "⚠️", ["รีเซ็ตแอป"]]
  ];
  var OPEN_KEY = "td_menu_open";
  function getOpen() { try { return localStorage.getItem(OPEN_KEY); } catch (e) { return null; } }
  function setOpen(v) { try { if (v == null) localStorage.removeItem(OPEN_KEY); else localStorage.setItem(OPEN_KEY, v); } catch (e) {} }

  var css = document.createElement("style");
  css.textContent =
    "#modal-root .mt-sec{margin-top:10px;}" +
    "#modal-root .mt-head{width:100%;margin:0 !important;padding:12px 14px;min-height:58px;}" +
    "#modal-root .mt-head .mt-ic{font-size:20px;flex-shrink:0;width:26px;text-align:center;}" +
    "#modal-root .mt-head .mt-tx{flex:1;min-width:0;}" +
    "#modal-root .mt-head .mt-sub{font-size:11.5px;color:#5A5A5A;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:400;}" +
    "#modal-root .mt-head .mt-ch{flex-shrink:0;font-size:14px;transition:transform .15s;}" +
    "#modal-root .mt-sec.open .mt-head .mt-ch{transform:rotate(90deg);}" +
    "#modal-root .mt-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#C2410C;margin-left:6px;vertical-align:middle;}" +
    "#modal-root .mt-sec .mt-body{display:none;padding:8px 0 4px 14px;border-left:3px solid rgba(0,0,0,0.18);margin:8px 0 4px 12px;}" +
    "#modal-root .mt-sec.open .mt-body{display:grid;}" +
    "#modal-root .mt-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;}" +
    "#modal-root .mt-grid .srow{margin:0 !important;padding:10px 12px;min-height:50px;}" +
    "#modal-root .mt-grid .srow > div{flex:1;min-width:0;}" +
    "#modal-root .mt-grid .srow > div > div + div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
    "#modal-root .mt-danger{margin-top:22px;padding-top:12px;border-top:1px dashed rgba(0,0,0,0.35);}" +
    "@media (min-width:720px){#modal-root .mt-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr);}}";
  document.head.appendChild(css);

  function titleOf(row) {
    var t = row.querySelector("div > div");
    return (t ? t.textContent : row.textContent).trim();
  }
  function tidy() {
    var box = document.getElementById("modal-box");
    if (!box || box.querySelector(".mt")) return;
    var rows = Array.prototype.slice.call(box.querySelectorAll(".srow:not(.mt-head)"));
    if (rows.length < 8) return;                                   // ไม่ใช่หน้าตั้งค่า
    var head = box.firstElementChild;
    var buckets = GROUPS.map(function () { return []; }), rest = [];
    rows.forEach(function (r) {
      var t = titleOf(r), gi = -1;
      GROUPS.some(function (g, i) { if (g[2].some(function (k) { return t.indexOf(k) === 0; })) { gi = i; return true; } return false; });
      if (gi < 0) rest.push(r); else buckets[gi].push(r);
    });
    // เรียงในหมวดตามลำดับที่กำหนด ไม่ใช่ลำดับที่ชั้นต่าง ๆ เติมเข้ามา
    buckets.forEach(function (b, i) {
      var keys = GROUPS[i][2];
      b.sort(function (x, y) {
        var ix = keys.findIndex(function (k) { return titleOf(x).indexOf(k) === 0; }), iy = keys.findIndex(function (k) { return titleOf(y).indexOf(k) === 0; });
        return ix - iy;
      });
    });
    var wrap = document.createElement("div"); wrap.className = "mt", open = getOpen();
    // พับทุกหมวด เห็นแค่หัวข้อ + ชื่อรายการข้างใน · แตะเพื่อกาง (กางได้ทีละหมวด จำไว้ครั้งหน้า)
    // แถวไหนมีคำเตือน (คำอธิบายสีส้ม/แดง เช่น "ยังไม่มีรหัสกู้คืน") หัวหมวดมีจุดสีส้มบอก
    function warns(r) {
      var t = titleOf(r);
      if (t.indexOf("รีเซ็ตแอป") === 0) return false;                       // คำเตือนประจำของปุ่มอันตราย ไม่ใช่เรื่องต้องทำ
      if (t.indexOf("สำรอง") === 0 && window.__backupQuiet && window.__backupQuiet()) return false;   // ซิงค์คลาวด์อยู่ ไม่ต้องรีบสำรองไฟล์
      var sub = r.querySelector("div > div + div"), c = sub && sub.style.color;
      return !!(c && !/90, 90, 90|#5a5a5a/i.test(c));
    }
    function section(title, icon, list, danger) {
      if (!list.length) return;
      var sec = document.createElement("div"); sec.className = "mt-sec" + (danger ? " mt-danger" : "") + (open === title ? " open" : "");
      var h = document.createElement("button"); h.type = "button"; h.className = "srow mt-head"; h.setAttribute("aria-expanded", open === title ? "true" : "false");
      var names = list.map(titleOf).map(function (t) { return t.replace(/\s*[·(].*$/, ""); });
      h.innerHTML = '<span class="mt-ic">' + icon + '</span><div class="mt-tx"><div style="font-weight:700;">' + esc(title) +
        (list.some(warns) ? '<span class="mt-dot" aria-label="มีเรื่องที่ควรดู"></span>' : '') + '</div>' +
        '<div class="mt-sub">' + esc(names.join(" · ")) + '</div></div><span class="mt-ch" aria-hidden="true">›</span>';
      var g = document.createElement("div"); g.className = "mt-grid mt-body";
      list.forEach(function (r) { g.appendChild(r); });
      h.addEventListener("click", function () {
        var now = !sec.classList.contains("open");
        Array.prototype.forEach.call(wrap.querySelectorAll(".mt-sec.open"), function (x) { x.classList.remove("open"); x.firstChild.setAttribute("aria-expanded", "false"); });
        if (now) { sec.classList.add("open"); h.setAttribute("aria-expanded", "true"); setOpen(title); } else setOpen(null);
        if (now && sec.scrollIntoView) setTimeout(function () { sec.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, 30);
      });
      sec.appendChild(h); sec.appendChild(g); wrap.appendChild(sec);
    }
    GROUPS.forEach(function (g, i) { if (i < GROUPS.length - 1) section(g[0], g[1], buckets[i]); });
    section("อื่น ๆ", "⋯", rest);
    section(GROUPS[GROUPS.length - 1][0], GROUPS[GROUPS.length - 1][1], buckets[GROUPS.length - 1], true);
    // ลบแค่หัวข้อหมวดเดิม (ส่วนอื่นที่อาจมีในหน้าตั้งค่ายังอยู่ครบ) แล้ววางชุดใหม่ต่อจากหัว "ตั้งค่า"
    Array.prototype.slice.call(box.querySelectorAll(".statlabel")).forEach(function (c) { if (c.parentNode) c.parentNode.removeChild(c); });
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
