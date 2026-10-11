/* ชั้นเว็บแอป: ความเร็ว — tools/update-lesson.py ฝังไฟล์นี้ไว้ท้าย lesson/index.html (ชั้นแรก ๆ ก่อนชั้นที่ห่อ save)

   วัดด้วย tools/perf-lesson.js (คาบ 3,351 · นักเรียน 80 มีรูป 40 · CPU ช้าลง 4 เท่า) แล้วแก้ที่ต้นเหตุ:
   • แท็บ นักเรียน › บันทึก วาดทุกคาบในครั้งเดียว และฝังรูปนักเรียน (data URL ~30 KB) ลงในทุกการ์ด
     = HTML 57.7 MB / 71,577 ชิ้น ใช้ 24 วินาที → วาดทีละ 40 คาบ เลื่อนลงแล้วเติมเอง และรูปใช้ blob: URL สั้น ๆ
     (เบราว์เซอร์ถอดรหัสรูปครั้งเดียวใช้ทุกที่) · หน้ารายคน/สัปดาห์/รายได้ก็เบาลงจากรูปเหมือนกัน
   • ฟังก์ชันของแอปที่กรองคาบทั้งหมดซ้ำทีละนักเรียน/ทีละคอร์ส/ทีละวัน (หน้ารายคน 80 คน × 3,351 คาบ หลายรอบ)
     → จัดกลุ่มคาบครั้งเดียวต่อรอบการวาด แล้วให้ฟังก์ชันเดิมทำงานกับชุดย่อยของคนนั้น (ผลเหมือนเดิมทุกตัว
     เพราะตัวเดิมกรองด้วยเงื่อนไขเดียวกันอยู่แล้ว) · ดัชนีล้างเองทุกครั้งที่บันทึก และทุกงาน (task) ใหม่
   • ตรวจประเภทคาบ (kindAudit) เดิมไล่ทุกคาบ × คาบของนักเรียนคนนั้นหลายรอบ (100 ms ทุกครั้งที่เปิดภาพรวม/ตั้งค่า/รายคน)
     → นับครั้งเดียวต่อคน ได้ผลเท่ากันทุกข้อ (tools/test-speed.js เทียบกับตัวเดิม)
   • บันทึก (save): รูปนักเรียนทั้งหมด (~1 MB) ถูกแปลงเป็นข้อความใหม่ทุกครั้งแม้ไม่ได้เปลี่ยน → ข้ามเมื่อรูปไม่เปลี่ยน
     (เทียบทีละรูป + ความยาวที่เก็บไว้ · ไม่ข้ามตอนที่ระบบกันข้อมูลหายจะทำสำเนา) ตัว save ของแอปทำงานเหมือนเดิมทุกขั้น
   • สำเนาสำรองใน IndexedDB (mirror) เดิมเขียนทั้งก้อน 0.7 วินาทีหลังทุกการแก้ (กระตุก ~300 ms บนมือถือ)
     → รอให้หยุดแก้ 2 วินาทีแล้วเขียนตอนเครื่องว่าง · ปิด/สลับแอประหว่างรอ เขียนทันที (เดิมไม่มี)
   • งานวาดเล็ก ๆ: ตัวเงินใช้ตัวจัดรูปแบบตัวเดียวซ้ำ · วงแหวนความคืบหน้าจัดหน้าครั้งเดียวแทนทีละวง
     · รายการยาว (การ์ดบันทึก รายชื่อ) ใช้ content-visibility:auto ส่วนนอกจอไม่ต้องจัดหน้า/วาด (เร็วขึ้น ~3 เท่า)
     · normName (ตัดคำนำหน้า/ช่องว่างของชื่อ) จำผลไว้ — หน้ารายคนเรียกหลายพันครั้ง
   ผลเทียบตัวเดิม: tools/test-speed.js · ตัวเลขก่อน/หลัง: README หัวข้อ "ความเร็ว" */
(function () {
  "use strict";
  var NEED = ["avatarHtml", "studentHistory", "studentSummary", "studentSince", "lessonsOfCourse", "enrollmentLessons", "lessonsOnDate",
              "rosterEntryExists", "getStudents", "kindAudit", "logSubView", "onSearch", "getFiltered", "cardHtml", "save", "scheduleMirror", "writeMirror"];
  var miss = NEED.filter(function (n) { return typeof window[n] !== "function"; });
  if (miss.length) { window.__speed = "missing: " + miss.join(","); return; }

  /* ── 1) ดัชนีคาบต่อรอบการวาด ──
     ใช้ได้ในงานเดียวกัน (ล้างใน microtask ถัดไป) และล้างทุกครั้งที่ save() — ข้อมูลที่แก้แล้วบันทึก วาดใหม่เห็นทันที */
  var EP = 0, DV = 0, armed = false, DEPTH = 0, C = { ep: -1 };     // EP: รอบงาน · DV: รุ่นข้อมูล (เพิ่มทุกครั้งที่บันทึก)
  function epoch() {
    if (!armed) { armed = true; Promise.resolve().then(function () { armed = false; EP++; }); }
    return EP;
  }
  function fresh() {
    if (DEPTH > 0 && C.ep >= 0) return C;                 // ระหว่างสลับชุดคาบชั่วคราว ใช้ดัชนีที่สร้างจากชุดเต็ม
    var e = epoch();
    if (C.ep !== e || C.lessons !== S.lessons || C.n !== S.lessons.length) C = { ep: e, lessons: S.lessons, n: S.lessons.length };
    return C;
  }
  function group(name, keyOf) {
    var c = fresh();
    if (!c[name]) {
      var m = new Map(), L = c.lessons;                   // ชุดเต็มเสมอ (แม้เรียกระหว่างสลับชุดย่อย)
      for (var i = 0; i < L.length; i++) { var l = L[i], k = keyOf(l), a = m.get(k); if (a) a.push(l); else m.set(k, [l]); }
      c[name] = m;
    }
    return c[name];
  }
  var NONE = [];
  function byStudent(s) { return group("stu", function (l) { return l.student; }).get(s) || NONE; }
  function byCourse(id) { return group("crs", function (l) { return l.courseId; }).get(id) || NONE; }
  function byDate(d) { return group("day", function (l) { return l.date; }).get(d) || NONE; }
  // เรียกฟังก์ชันเดิมของแอป โดยให้ S.lessons เป็นเฉพาะคาบที่เกี่ยวข้องชั่วคราว (ลำดับเดิม)
  function scoped(sub, fn, self, args) {
    var keep = S.lessons;
    DEPTH++; S.lessons = sub;
    try { return fn.apply(self, args); } finally { S.lessons = keep; DEPTH--; }
  }
  window.__lessonsOf = function (s) { return byStudent(s).slice(); };
  // ค่าที่คำนวณจากข้อมูลคาบ ใช้ซ้ำได้ภายในรอบการวาดเดียวกัน (ชั้นอื่นใช้: เวลาปกติของสถานที่ งานสำคัญ)
  window.__memo = function (key, fn) {
    var c = fresh(), m = c.memo || (c.memo = new Map());
    if (m.has(key)) return m.get(key);
    var v = fn(); m.set(key, v); return v;
  };
  window.__speedBump = function () { EP++; };

  var ORIG = window.__speedOrig = {}, NEW = window.__speedNew = {};   // ให้ tools/test-speed.js เทียบผลกับตัวเดิม
  function wrapScoped(name, subOf) {
    var orig = window[name];
    window[name] = NEW[name] = function () { return scoped(subOf.apply(null, arguments), orig, this, arguments); };
    ORIG[name] = orig;
  }
  // ทุกตัวนี้กรอง S.lessons ด้วยเงื่อนไขที่ครอบคลุมโดยชุดย่อยอยู่แล้ว → ผลเท่าเดิม
  wrapScoped("studentHistory", function (s) { return byStudent(s); });
  wrapScoped("studentSummary", function (s) { return byStudent(s); });
  wrapScoped("studentSince", function (s) { return byStudent(s); });
  wrapScoped("lessonsOfCourse", function (id) { return byCourse(id); });
  wrapScoped("enrollmentLessons", function (e) { return e ? byStudent(e.student) : NONE; });
  wrapScoped("lessonsOnDate", function (d) { return byDate(d); });
  wrapScoped("rosterEntryExists", function (e, d) { return byDate(d); });
  // วางตารางจากไลน์ / ฟอร์มคาบ / ใบฝากสอน: ไล่คาบทั้งหมดทีละคน → เฉพาะคาบของคนนั้น
  if (typeof window.lessonsOf === "function") wrapScoped("lessonsOf", function (k) { return byStudent(k); });
  if (typeof window.lastLessonOf === "function") wrapScoped("lastLessonOf", function (k) { return byStudent(k); });
  if (typeof window.slotScore === "function") wrapScoped("slotScore", function (k) { return byStudent(k); });
  if (typeof window.previousTaughtLesson === "function") wrapScoped("previousTaughtLesson", function (l) { return l ? byStudent(l.student) : NONE; });
  if (typeof window.likelyKind === "function") wrapScoped("likelyKind", function (k) { return byStudent(String(k || "").trim()); });

  // normName เป็นฟังก์ชันบริสุทธิ์ (ข้อความ → ข้อความ) ถูกเรียกหลายพันครั้งต่อการวาดหน้ารายคน (ตรวจชื่อซ้ำทีละคู่)
  if (typeof window.normName === "function") {
    var origNorm = window.normName, NM = new Map();
    window.normName = function (v) {
      if (typeof v !== "string") return origNorm(v);
      var r = NM.get(v);
      if (r === undefined) { r = origNorm(v); if (NM.size > 5000) NM.clear(); NM.set(v, r); }
      return r;
    };
  }

  // รายชื่อนักเรียน: เดิมไล่ทะเบียน + ทุกคาบ + คอร์ส + ตาราง ทุกครั้งที่ถูกเรียก (หลายสิบครั้งต่อการวาด)
  var origStudents = window.getStudents;
  window.getStudents = function () {
    var c = fresh();
    if (!c.students || c.studentsN !== S.students.length || c.coursesN !== S.courses.length || c.schedN !== S.schedule.length) {
      c.students = DEPTH > 0 ? scoped(c.lessons, origStudents, this, arguments) : origStudents.apply(this, arguments);
      c.studentsN = S.students.length; c.coursesN = S.courses.length; c.schedN = S.schedule.length;
    }
    return c.students.slice();
  };

  /* ── 2) ตรวจประเภทคาบ: ผลเหมือนตัวเดิมทุกข้อ แต่นับครั้งเดียวต่อคน ── */
  var origAudit = window.kindAudit, AUD = null;
  window.__kindAuditOrig = origAudit;
  window.kindAudit = function () {
    // ผลตรวจเป็นคำเตือน ไม่ใช่ตัวเลขเงิน: ใช้ซ้ำได้จนกว่าจะบันทึก (DV) หรือจำนวนคาบ/คอร์ส/สถานที่เปลี่ยน
    var c = fresh();
    if (AUD && AUD.dv === DV && AUD.lessons === c.lessons && AUD.n === c.lessons.length && AUD.nc === S.courses.length && AUD.np === S.places.length) return AUD.out.slice();
    var total = new Map(), kinds = new Map(), school = new Map(), nonSchoolAt = new Set();
    var i, l, L = c.lessons;
    for (i = 0; i < L.length; i++) {
      l = L[i];
      total.set(l.student, (total.get(l.student) || 0) + 1);
      var kk = l.student + "\u0001" + l.kind;
      kinds.set(kk, (kinds.get(kk) || 0) + 1);
      if (l.kind === "school") school.set(l.student, (school.get(l.student) || 0) + 1);
      else nonSchoolAt.add(l.student + "\u0001" + l.date + "\u0001" + l.time);
    }
    var out = [];
    for (i = 0; i < L.length; i++) {
      l = L[i];
      if (l.kindChecked) continue;
      var why = [], suggest = null;
      if (l.kind === "private") {
        var co = getCourse(l.courseId);
        if (l.courseId == null) why.push("คาบส่วนตัวที่ไม่ได้ผูกคอร์ส — ไม่นับครั้งและไม่มีรายได้");
        else if (!co) why.push("คอร์สที่ผูกไว้ถูกลบไปแล้ว");
        else if (co.student !== l.student) why.push("ผูกกับคอร์สของ " + displayName(co.student) + " ไม่ใช่ของนักเรียนคนนี้");
        if (l.courseId == null && !coursesOf(l.student).length && (school.get(l.student) || 0) > 0) suggest = "school";
      } else {
        if (l.placeId == null || !getPlace(l.placeId)) why.push("คาบโรงเรียนที่ไม่ได้ระบุสถานที่");
      }
      var others = (total.get(l.student) || 1) - 1;
      if (others >= 3) {
        var same = (kinds.get(l.student + "\u0001" + l.kind) || 1) - 1;
        if (same / others <= 0.15) {
          var other = l.kind === "school" ? "private" : "school";
          why.push("คาบอื่นของนักเรียนคนนี้ " + (others - same) + "/" + others + " คาบเป็นแบบ" + KIND[other].label);
          suggest = other;
        }
      }
      if (l.kind === "school" && nonSchoolAt.has(l.student + "\u0001" + l.date + "\u0001" + l.time)) why.push("วันเวลาเดียวกันมีคาบแบบส่วนตัวอยู่แล้ว — อาจบันทึกซ้ำ");
      if (why.length) out.push({ l: l, why: why, suggest: suggest });
    }
    out.sort(function (a, b) { return (b.l.date + b.l.time) < (a.l.date + a.l.time) ? -1 : 1; });
    AUD = { dv: DV, lessons: c.lessons, n: c.lessons.length, nc: S.courses.length, np: S.places.length, out: out };
    return out.slice();
  };

  /* ── 3) รูปนักเรียน: blob: URL แทน data URL ยาว ๆ ในทุกการ์ด ── */
  var BLOB = new Map();
  function photoUrl(src) {
    if (typeof src !== "string" || src.length < 4096 || src.slice(0, 5) !== "data:" || typeof URL === "undefined" || !URL.createObjectURL) return src;
    var u = BLOB.get(src);
    if (u) return u;
    try {
      var comma = src.indexOf(","), meta = src.slice(5, comma), mime = meta.split(";")[0] || "image/jpeg";
      var bin = /;base64/i.test(meta) ? atob(src.slice(comma + 1)) : decodeURIComponent(src.slice(comma + 1));
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      u = URL.createObjectURL(new Blob([arr], { type: mime }));
    } catch (e) { return src; }
    BLOB.set(src, u);
    if (BLOB.size > 16 && BLOB.size > Object.keys(S.photos || {}).length * 2) prune();
    return u;
  }
  function prune() {
    var live = new Set(); Object.keys(S.photos || {}).forEach(function (k) { live.add(S.photos[k]); });
    BLOB.forEach(function (u, src) { if (!live.has(src)) { URL.revokeObjectURL(u); BLOB.delete(src); } });
  }
  window.__photoUrl = photoUrl;
  // แปลงรูปล่วงหน้าตอนเครื่องว่าง (fetch ของ data: URL ถอดรหัสนอกเธรดหลัก) — หน้าแรกที่มีรูปไม่ต้องรอ
  function prewarm() {
    if (typeof fetch !== "function" || !S || !S.photos) return;
    // ตอนเปิดแอป รูปในหน่วยความจำมาจากที่เก็บตรง ๆ: ยืนยันครั้งเดียวว่าตรงกัน การบันทึกครั้งแรกจะได้ข้ามรูปด้วย
    try { if (!PH) { var cur = lsGet("td_photos"); if (cur != null && JSON.stringify(S.photos) === cur) remember(); } } catch (e) {}
    var srcs = Object.keys(S.photos).map(function (k) { return S.photos[k]; })
      .filter(function (v) { return typeof v === "string" && v.length >= 4096 && v.slice(0, 5) === "data:" && !BLOB.has(v); });
    (function next() {
      var src = srcs.shift(); if (!src) return;
      fetch(src).then(function (r) { return r.blob(); }).then(function (b) {
        if (!BLOB.has(src)) BLOB.set(src, URL.createObjectURL(b));
      }).catch(function () {}).then(next);
    })();
  }
  if (typeof window.startApp === "function") {
    var origStartP = window.startApp;
    window.startApp = function () { var r = origStartP.apply(this, arguments); setTimeout(prewarm, 1200); return r; };
  }
  var origAvatar = window.avatarHtml;
  window.avatarHtml = function (name, photo, size) { return origAvatar.call(this, name, photoUrl(photo), size); };

  /* ── 4) แท็บบันทึก: วาดทีละ 40 คาบ ── */
  var PAGE = 40, SHOW = PAGE, KEY = null, LIST = [];
  function keyNow() { return S.filter + "\u0001" + S.search; }
  function keepVisible(list) {
    // คาบที่กางอยู่ / เพิ่งแก้ ต้องอยู่ในหน้าที่วาด
    [S.expanded, window.FLASH_ID].forEach(function (id) {
      if (id == null) return;
      for (var i = 0; i < list.length; i++) if (list[i].id === id) { if (i >= SHOW) SHOW = Math.ceil((i + 1) / PAGE) * PAGE; break; }
    });
  }
  function moreHtml(rest) {
    return rest > 0 ? '<button type="button" class="btn-g" id="cards-more" style="width:100%;margin:4px 0 16px;">แสดงเพิ่ม (อีก ' + rest + ' คาบ)</button>' : '';
  }
  function cardsHtml(list) {
    if (!list.length) return null;
    return list.slice(0, SHOW).map(cardHtml).join("") + moreHtml(list.length - SHOW);
  }
  window.logSubView = function () {
    var names = getStudents();
    var list = getFiltered();
    if (KEY !== keyNow()) { KEY = keyNow(); SHOW = PAGE; }
    keepVisible(list);
    LIST = list;
    var opts = ["ทั้งหมด"].concat(names).map(function (n) {
      return '<option value="' + esc(n) + '"' + (n === S.filter ? ' selected' : '') + '>' + esc(n) + '</option>';
    }).join("");
    var cards = cardsHtml(list);
    return '<div style="display:flex;gap:9px;margin-bottom:16px;flex-wrap:wrap;">' +
        '<input id="search-inp" placeholder="ค้นหาชื่อ / หัวข้อ / บันทึก..." value="' + esc(S.search) + '" oninput="onSearch(this.value)" style="flex:1 1 170px;min-width:140px;">' +
        '<select onchange="S.filter=this.value;renderAll();" style="width:auto;min-width:124px;flex:0 1 auto;">' + opts + '</select></div>' +
      '<div id="cards-count" class="mono" style="font-size:11px;color:#5A5A5A;margin-bottom:12px;">' + countText(list) + '</div>' +
      '<div id="cards-tail">' + (cards != null ? cards : '<div class="empty" style="padding:44px 20px;">— ไม่พบคาบสอน —</div>') + '</div>';
  };
  window.onSearch = function (v) {
    S.search = v;
    var tail = document.getElementById("cards-tail");
    if (!tail) { renderLessonsView(); return; }
    var list = getFiltered();
    KEY = keyNow(); SHOW = PAGE; LIST = list;
    var cards = cardsHtml(list);
    tail.innerHTML = cards != null ? cards : '<div class="empty">— ไม่พบคาบสอนที่ค้นหา —</div>';
    var cl = document.getElementById("cards-count");
    if (cl) cl.textContent = countText(list);
    armMore();
  };
  function showMore() {
    var btn = document.getElementById("cards-more");
    if (!btn || !LIST.length) return;
    var from = SHOW; SHOW += PAGE;
    btn.insertAdjacentHTML("beforebegin", LIST.slice(from, SHOW).map(cardHtml).join(""));
    var rest = LIST.length - SHOW;
    if (rest > 0) btn.textContent = "แสดงเพิ่ม (อีก " + rest + " คาบ)"; else btn.remove();
  }
  window.__logShowMore = showMore;
  var IO = null;
  function armMore() {
    var btn = document.getElementById("cards-more");
    if (!btn || typeof IntersectionObserver === "undefined") return;
    if (!IO) IO = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting || !e.target.isConnected) return;
        showMore();
        // ปุ่มยังอยู่ใกล้จอ (จอสูง/การ์ดสั้น): สังเกตใหม่ให้ได้รายงานสถานะล่าสุด แล้วเติมต่อจนพ้นจอ
        var b = document.getElementById("cards-more");
        IO.unobserve(e.target); if (b) IO.observe(b);
      });
    }, { rootMargin: "600px 0px" });
    IO.disconnect(); IO.observe(btn);
  }
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest && e.target.closest("#cards-more");
    if (b) { e.preventDefault(); showMore(); armMore(); }
  });
  if (typeof window.renderStudentsView === "function") {
    var origSV = window.renderStudentsView;
    window.renderStudentsView = function () { var r = origSV.apply(this, arguments); armMore(); return r; };
  }

  /* ── 4.5) งานวาดเล็ก ๆ ที่เกิดบ่อย ── */
  // ตัวเงิน: toLocaleString("en-US") สร้างตัวจัดรูปแบบใหม่ทุกครั้ง (หน้าภาพรวมเรียกหลายร้อยครั้ง) → ใช้ตัวเดียวซ้ำ ผลเหมือนกันทุกตัวอักษร
  if (typeof window.fmtMoney === "function" && typeof Intl !== "undefined" && Intl.NumberFormat) {
    var NF = new Intl.NumberFormat("en-US");
    window.fmtMoney = function (n) { return "฿" + NF.format(Math.round(num(n, 0))); };
  }
  // วงแหวนความคืบหน้า: เดิมบังคับจัดหน้าใหม่ทีละวง (หน้ารายคนมีหลายสิบวง) → ตั้งค่าเริ่มทุกวง จัดหน้าครั้งเดียว แล้วค่อยเล่นพร้อมกัน
  if (typeof window.animateRings === "function" && typeof window.RING_PREV === "object") {
    window.animateRings = function (root, entering) {
      var still = reducedMotion(), run = [];
      Array.prototype.forEach.call(root.querySelectorAll(".ring-arc[data-k]"), function (el) {
        var k = el.getAttribute("data-k"), to = parseFloat(el.getAttribute("data-off")), circ = parseFloat(el.getAttribute("data-circ"));
        var from = RING_PREV[k];
        if (from === undefined) from = entering ? circ : to;
        RING_PREV[k] = to;
        if (still || Math.abs(from - to) < 0.5) return;
        el.style.transition = "none"; el.style.strokeDashoffset = from;
        run.push([el, to]);
      });
      if (!run.length) return;
      run[0][0].getBoundingClientRect();
      run.forEach(function (x) { x[0].style.transition = "stroke-dashoffset .75s cubic-bezier(.2,.8,.2,1)"; x[0].style.strokeDashoffset = x[1]; });
    };
  }
  // รายการยาว (การ์ดบันทึก รายชื่อนักเรียน): ส่วนที่อยู่นอกจอไม่ต้องจัดหน้า/วาดจนกว่าจะเลื่อนถึง
  var cv = document.createElement("style");
  cv.textContent = "#cards-tail > .card, #people-rows > .acard{content-visibility:auto;contain-intrinsic-size:auto 88px;}";
  document.head.appendChild(cv);

  /* ── 5) บันทึก: ข้ามการแปลงรูปทั้งหมดเป็นข้อความ เมื่อรูปไม่เปลี่ยน ── */
  var PH = null;                                        // { m: สำเนา key→รูป, n: จำนวน, len: ความยาวที่เก็บไว้ }
  function photosSame() {
    if (!PH || !S.photos || typeof S.photos !== "object") return false;
    var ks = Object.keys(S.photos);
    if (ks.length !== PH.n) return false;
    for (var i = 0; i < ks.length; i++) if (PH.m[ks[i]] !== S.photos[ks[i]] || !(ks[i] in PH.m)) return false;
    var cur = lsGet("td_photos");
    return cur != null && cur.length === PH.len;
  }
  function remember() {
    var cur = lsGet("td_photos"), m = Object.create(null);
    if (cur == null || !S.photos || typeof S.photos !== "object") { PH = null; return; }
    Object.keys(S.photos).forEach(function (k) { m[k] = S.photos[k]; });
    PH = { m: m, n: Object.keys(m).length, len: cur.length };
  }
  function guardMayRun() {
    // ระบบกันข้อมูลหายของแอปทำสำเนาจากที่เก็บ (รวมรูป) ตอนคาบลดฮวบ — ช่วงนั้นใช้ทางเดิมทั้งหมด
    var n = S.lessons.length;
    return typeof LAST_N !== "undefined" && LAST_N !== null && n < LAST_N - 2 && n < LAST_N * 0.8;
  }
  var origSave = window.save;
  window.save = function () {
    EP++; DV++;                                         // ข้อมูลอาจเปลี่ยน: ดัชนีของรอบนี้ใช้ไม่ได้แล้ว
    var idx = -1, skip = false;
    if (Array.isArray(window.SAVE_KEYS) && photosSame() && !guardMayRun()) {
      for (var i = 0; i < SAVE_KEYS.length; i++) if (SAVE_KEYS[i][1] === "photos") { idx = i; break; }
      skip = idx >= 0;
    }
    var removed = skip ? SAVE_KEYS.splice(idx, 1)[0] : null, r;
    try { r = origSave.apply(this, arguments); }
    finally { if (removed) SAVE_KEYS.splice(idx, 0, removed); }
    EP++;
    if (r === true) { if (!skip) remember(); } else PH = null;
    return r;
  };
  window.addEventListener("storage", function (e) { if (!e.key || e.key === "td_photos") PH = null; });

  /* ── 6) สำเนาสำรอง IndexedDB: รอหยุดแก้แล้วเขียนตอนว่าง ── */
  var idle = window.requestIdleCallback ? function (fn) { requestIdleCallback(fn, { timeout: 3000 }); } : function (fn) { setTimeout(fn, 50); };
  var pendingMirror = false;
  window.scheduleMirror = function () {
    clearTimeout(MIRROR_T);
    pendingMirror = true;
    MIRROR_T = setTimeout(function () { idle(function () { if (pendingMirror) { pendingMirror = false; writeMirror(); } }); }, 2000);
  };
  var origMirror = window.writeMirror;
  window.writeMirror = function () { pendingMirror = false; return origMirror.apply(this, arguments); };
  function flush() { if (pendingMirror) { pendingMirror = false; try { writeMirror(); } catch (e) {} } }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush(); });
  window.addEventListener("pagehide", flush);

  window.__speed = "on";
})();
