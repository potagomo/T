/* ชั้นเว็บแอป: เวลาเรียนประจำของแต่ละสถานที่ + วางตารางจากไลน์เลือก "ส่วนตัว" ได้ — tools/update-lesson.py ฝังไฟล์นี้ไว้ท้าย lesson/index.html

   เดิมคาบใหม่เริ่มที่ 60 นาทีเสมอ (ฟอร์ม + เพิ่ม / นักเรียนใหม่จากไลน์ / ตารางประจำที่ยังไม่เคยสอน)
   ครูที่สอนโรงเรียนละ 50 นาทีต้องกดเปลี่ยนทุกคาบ
   ชั้นนี้: สถานที่สอนมี "เวลาเรียนปกติ" (⚙ › สถานที่สอน › ✎ หรือปุ่ม "ตั้งราคาและเวลา…เป็นค่าประจำ" ในฟอร์ม)
   ลำดับที่ใช้กับคาบใหม่: เวลาที่ข้อความไลน์ระบุ › เวลาของคาบล่าสุดของนักเรียนคนนั้นที่สถานที่นั้น (ค่าเดิม ไม่ต้องทำอะไร)
   › เวลาปกติของสถานที่ (ยังไม่ตั้ง = ความยาวที่สอนบ่อยที่สุดใน 20 คาบล่าสุดที่นั่น) › 60 นาที · เปลี่ยนเองในฟอร์มได้ตลอด และคาบถัดไปของนักเรียนคนนั้นจะใช้ค่าที่เปลี่ยน
   คาบที่บันทึกไว้แล้วไม่ถูกแก้

   วางตารางจากไลน์: ช่องสถานที่สอนมีตัวเลือก "ส่วนตัว (คอร์ส)" — ลงเป็นคาบส่วนตัว ผูกคอร์สให้ถ้าน้องมีคอร์สเดียว
   ตรวจซ้ำกับคาบส่วนตัววันนั้น (ไม่แตะคาบโรงเรียน) */
(function () {
  "use strict";
  var NEED = ["getPlace", "getPlaces", "payBlockHtml", "rebuildPayBlock", "showLessonModal", "setDur_school", "durationFieldHtml",
              "durationApply", "showPlaceModal", "placeRowHtml", "saveDefaultRate", "updatePlace", "planEntry", "applyImport",
              "showPasteImport", "migrate", "lessonFromRosterEntry", "lastLessonOf", "lessonsOf", "coursesOf", "courseStats"];
  var miss = NEED.filter(function (n) { return typeof window[n] !== "function"; });
  if (miss.length) { window.__placeTime = "missing: " + miss.join(","); return; }

  // ยังไม่ได้ตั้งเวลาปกติ: ดูจากคาบที่สอนจริงล่าสุดที่นั่น (20 คาบ) ถ้าความยาวเดียวกันเกินครึ่งก็ใช้ค่านั้น ไม่ต้องตั้งเอง
  function guessDur(p) {
    var ls = S.lessons.filter(function (l) { return l.kind === "school" && l.placeId === p.id && l.attendance !== "planned"; })
      .sort(function (a, b) { return (a.date + a.time) < (b.date + b.time) ? 1 : -1; }).slice(0, 20);
    if (ls.length < 3) return 0;
    var n = {}, best = 0, bestN = 0;
    ls.forEach(function (l) { var m = mins(l.duration); n[m] = (n[m] || 0) + 1; if (n[m] > bestN) { bestN = n[m]; best = m; } });
    return bestN * 2 > ls.length && best > 0 ? best / 60 : 0;
  }
  function placeDur(p) {
    if (!p) return 1;
    var d = parseFloat(p.dur);
    return d > 0 ? d : (guessDur(p) || 1);
  }
  function mins(h) { return Math.round(num(h, 1) * 60); }
  window.__placeDur = placeDur;

  /* ── ฟอร์มเพิ่มคาบ ── */
  // แอปเดิมเริ่มคาบใหม่ที่ 1 ชม. เสมอ ไม่ดูนักเรียนหรือสถานที่ — ตั้งให้ตามลำดับข้างบน จนกว่าครูจะแตะช่องเวลาเอง
  var DT = { id: null, touched: false, why: "" };
  function autoDur() {
    if (!window.EF || EF._mode !== "add" || EF.kind !== "school") return;
    if (DT.id !== EF.id) DT = { id: EF.id, touched: false, why: "" };
    if (DT.touched) return;
    var p = getPlace(EF.placeId), key = String(EF.student || "").trim();
    var prev = key && EF.placeId != null ? lastLessonOf(key, EF.placeId) : null;
    var d = prev ? num(prev.duration, 1) : placeDur(p);
    DT.why = prev ? "เท่าครั้งก่อนของ " + key : !p ? "" : p.dur ? "เวลาปกติของ " + p.name : guessDur(p) ? "เวลาที่สอนบ่อยที่ " + p.name : "";
    var clean = window.LESSON_BASE === JSON.stringify(EF);
    EF.duration = d;
    if (clean) LESSON_BASE = JSON.stringify(EF);          // ค่าตั้งต้น ไม่นับเป็น "ยังไม่บันทึก"
  }
  var origShow = window.showLessonModal;
  window.showLessonModal = function () { autoDur(); return origShow.apply(this, arguments); };
  var origRebuild = window.rebuildPayBlock;
  window.rebuildPayBlock = function () { autoDur(); return origRebuild.apply(this, arguments); };
  var origSetDur = window.setDur_school;
  window.setDur_school = function () { if (window.EF) DT = { id: EF.id, touched: true, why: "" }; return origSetDur.apply(this, arguments); };

  var origPay = window.payBlockHtml;
  window.payBlockHtml = function () {
    var html = origPay.apply(this, arguments);
    if (!window.EF || EF.kind !== "school") return html;
    var p = getPlace(EF.placeId);
    if (DT.id === EF.id && !DT.touched && DT.why) {
      html = html.replace('<span>นาที</span></div>', '<span>นาที</span><span class="hint" style="margin-left:4px;">' + esc(DT.why) + '</span></div>');
    }
    if (p) {
      html = html.replace(/(<button type="button" onclick="saveDefaultRate\(\)"[^>]*>)[^<]*(<\/button>)/,
        "$1ตั้งราคาและเวลานี้เป็นค่าประจำของ " + esc(p.name).replace(/\$/g, "$$$$") + "$2");
    }
    return html;
  };
  window.saveDefaultRate = function () {
    var p = getPlace(EF.placeId);
    if (!p) return;
    updatePlace(p.id, { rate: num(EF.rate, 0), payMode: payModeOf(EF), dur: num(EF.duration, 1) });
    toast("ค่าประจำของ " + p.name + ": " + fmtMoney(EF.rate) + rateUnit(payModeOf(EF)) + " · " + mins(EF.duration) + " นาที");
  };

  /* ── หน้าแก้สถานที่สอน ── */
  window.setDur_place = function (m, fromChip) { durationApply("dur-place", m, fromChip, function (h) { PF.dur = h > 0 ? h : null; }); };
  var origPlaceModal = window.showPlaceModal;
  window.showPlaceModal = function () {
    var r = origPlaceModal.apply(this, arguments);
    var ex = document.getElementById("pf-pay-ex");
    if (ex && !document.getElementById("pf-dur")) {
      var box = document.createElement("div"); box.id = "pf-dur";
      box.innerHTML = '<label>เวลาเรียนปกติ (นาที)</label>' + durationFieldHtml("dur-place", placeDur(PF) * 60, "setDur_place") +
        '<div class="hint" style="margin-top:4px;">' + (!(PF.dur > 0) && PF.id != null && guessDur(PF) ? "<span>ยังไม่ได้ตั้ง — ตอนนี้ใช้เวลาที่สอนบ่อยที่สุดที่นี่</span> · " : "") +
          '<span>คาบใหม่ที่นี่เริ่มที่เวลานี้ · นักเรียนที่เคยเรียนแล้วใช้เวลาเท่าครั้งก่อน · คาบที่บันทึกแล้วไม่เปลี่ยน</span></div>';
      ex.parentNode.insertBefore(box, ex.nextSibling);
    }
    return r;
  };
  var origRow = window.placeRowHtml;
  window.placeRowHtml = function (p) {
    var html = origRow.apply(this, arguments), money = fmtMoney(p.rate) + rateUnit(payModeOf(p));
    var i = html.indexOf(money);
    return i < 0 ? html : html.slice(0, i + money.length) + " · " + mins(placeDur(p)) + " นาที" + html.slice(i + money.length);
  };

  /* ── ตารางประจำ: คาบแรกของนักเรียนที่ยังไม่เคยเรียนที่นั่น ── */
  var origRoster = window.lessonFromRosterEntry;
  window.lessonFromRosterEntry = function (e) {
    var l = origRoster.apply(this, arguments);
    if (l && l.kind === "school" && !lastLessonOf(l.student, l.placeId)) l.duration = placeDur(getPlace(l.placeId));
    return l;
  };

  /* ── วางตารางจากไลน์ ── */
  function isPriv() { return window.PI && PI.kind === "private"; }
  function privDur(key) {
    var cs = coursesOf(key), act = cs.filter(function (c) { return courseStats(c).remaining > 0; });
    var c = (act.length === 1 ? act : cs.length === 1 ? cs : [])[0];
    return c && c.hoursPer ? num(c.hoursPer, 1) : 1;
  }
  function lastPriv(key) {
    var best = null;
    S.lessons.forEach(function (l) {
      if (l.student !== key || l.kind !== "private" || l.attendance === "planned") return;
      if (!best || (l.date + l.time) > (best.date + best.time)) best = l;
    });
    return best;
  }
  // planEntry ของแอปเดิมดูเฉพาะคาบโรงเรียน — ตอนเลือก "ส่วนตัว" ใช้ตัวนี้ (ตรรกะเดียวกัน สลับชนิดคาบ)
  function planPriv(i) {
    var e = PI.entries[i], key = PI.pick[i];
    var p = { i: i, e: e, key: key, isNew: key === "__new__", act: "none", note: "", lesson: null, warn: "" };
    var m = e._match;
    if (!key) { p.act = "choose"; p.warn = m.how === "similar" ? "ชื่อไม่ตรงกับใคร — ใช่คนนี้ไหม?" : "เลือกนักเรียน"; return p; }
    if (m.how === "ambiguous" && key === m.exact[0] && !PI.pickTouched[i]) p.warn = "มีชื่อนี้ " + m.exact.length + " คน — ตรวจว่าเลือกถูกคน";
    var day = p.isNew ? [] : lessonsOf(key, e.date);
    var same = day.filter(function (l) { return l.kind === "private"; });
    var other = day.filter(function (l) { return l.kind !== "private"; });
    if (other.length) p.privNote = "มีคาบโรงเรียนวันนี้ด้วย " + other.map(function (l) { return l.time; }).join(", ") + " น. (ไม่แตะ)";
    if (e.cancel) {
      var planned = same.filter(function (l) { return l.attendance === "planned"; })[0] || same[0];
      if (!planned) { p.act = "skip"; p.note = "ไม่มีคาบนี้ในแอป — ไม่ต้องทำอะไร"; return p; }
      p.lesson = planned;
      if (planned.attendance !== "planned") { p.act = "skip"; p.note = "บันทึกสถานะไว้แล้ว (" + attInfo(planned.attendance).label + ")"; return p; }
      p.act = "cancel"; p.note = "ยกเลิกคาบ " + (planned.time || "") + " น."; return p;
    }
    if (!e.time) { p.act = "skip"; p.note = "ไม่มีเวลาในข้อความ — ไม่ลง"; return p; }
    var done = same.filter(function (l) { return l.attendance !== "planned"; });
    var planned2 = same.filter(function (l) { return l.attendance === "planned"; });
    if (done.length) { p.act = "skip"; p.lesson = done[0]; p.note = "สอน/บันทึกไปแล้ว " + (done[0].time || "") + " น. — ข้าม"; return p; }
    if (planned2.length) {
      p.lesson = planned2[0];
      if (planned2[0].time === e.time && (!e.dur || num(planned2[0].duration, 1) === e.dur)) { p.act = "skip"; p.note = "มีในแอปแล้ว"; return p; }
      p.act = "move"; p.note = "เปลี่ยนเวลา " + (planned2[0].time || "-") + " → " + e.time + (e.dur ? " (" + fmtHours(e.dur) + ")" : ""); return p;
    }
    p.act = "create";
    var prev = p.isNew ? null : lastPriv(key);
    p.prev = prev;
    p.note = e.trial ? "ทดลองเรียน" : (prev && prev.nextLesson ? "ต่อจากครั้งก่อน: " + prev.nextLesson : (p.isNew ? "นักเรียนใหม่" : "คาบส่วนตัวใหม่"));
    return p;
  }
  var origPlan = window.planEntry;
  window.planEntry = function (i) {
    var e = PI.entries[i];
    if (!("_dur0" in e)) e._dur0 = e.dur || null;
    e.dur = e._dur0;                                   // เวลาจากข้อความเท่านั้นที่ใช้ตัดสินว่า "เปลี่ยนเวลา"
    var p = isPriv() ? planPriv(i) : origPlan.apply(this, arguments);
    // คาบใหม่ที่ข้อความไม่บอกความยาว: ค่าเดิมของนักเรียน › เวลาปกติของสถานที่ (แอปเดิมใช้ 60 นาทีเสมอ)
    if (p.act === "create" && !e._dur0) {
      e.dur = p.prev ? num(p.prev.duration, 1) : isPriv() ? (p.isNew ? 1 : privDur(p.key)) : placeDur(getPlace(PI.placeId));
    }
    return p;
  };

  // ตอนเลือก "ส่วนตัว" PI.placeId = null — คาบที่ applyImport เพิ่งสร้างจึงเป็น school ที่ไม่มี placeId
  // แปลงเป็นคาบส่วนตัวก่อน migrate() ของแอปเดิมจะเติมสถานที่เก่าให้
  var PRIV = null;
  var origApply = window.applyImport;
  window.applyImport = function () {
    PRIV = isPriv() ? { at: nowISO(), ids: S.lessons.reduce(function (o, l) { o[l.id] = 1; return o; }, {}), until: Date.now() + 60000 } : null;
    return origApply.apply(this, arguments);
  };
  var origMigrate = window.migrate;
  window.migrate = function () {
    if (PRIV) {
      var pv = PRIV; PRIV = null;
      if (Date.now() < pv.until) S.lessons.forEach(function (l) {
        if (pv.ids[l.id] || l.kind !== "school" || l.placeId != null || !l.importedAt || l.importedAt < pv.at) return;
        var cs = coursesOf(l.student), act = cs.filter(function (c) { return courseStats(c).remaining > 0; });
        var c = (act.length === 1 ? act : cs.length === 1 ? cs : [])[0];
        l.kind = "private"; l.placeId = null; l.rate = 0; l.courseId = c ? c.id : null;
        if (l.notes === "ทดลองเรียน (จากตารางโรงเรียน)") l.notes = "ทดลองเรียน";
      });
    }
    return origMigrate.apply(this, arguments);
  };

  var origPaste = window.showPasteImport;
  window.showPasteImport = function () {
    var r = origPaste.apply(this, arguments);
    var sel = document.querySelector('#modal-box select[onchange^="PI.placeId"]');
    if (!sel) return r;
    sel.removeAttribute("onchange");
    var o = document.createElement("option");
    o.value = "private"; o.textContent = "ส่วนตัว (คอร์ส)";
    sel.appendChild(o);
    if (isPriv()) sel.value = "private";
    sel.addEventListener("change", function () {
      if (sel.value === "private") { PI.kind = "private"; PI.placeId = null; }
      else { PI.kind = "school"; PI.placeId = parseInt(sel.value, 10); }
      PI.placeTouched = true;
      reparseKeepText();
    });
    // บอกว่าคาบใหม่จะยาวเท่าไร
    var p = getPlace(PI.placeId), wrap = sel.closest("div") && sel.closest("div").parentNode;
    if (wrap && wrap.parentNode) {
      var h = document.createElement("div"); h.className = "hint"; h.id = "pi-dur-hint"; h.style.marginTop = "6px";
      h.textContent = isPriv()
        ? "ลงเป็นคาบส่วนตัว · เวลาเรียนตามคอร์ส หรือเท่าครั้งก่อนของน้อง"
        : "คาบใหม่ " + mins(placeDur(p)) + " นาที (เวลาปกติของ " + (p ? p.name : "สถานที่") + ") · นักเรียนที่เคยเรียนแล้วใช้เวลาเท่าครั้งก่อน";
      wrap.parentNode.insertBefore(h, wrap.nextSibling);
    }
    return r;
  };
  window.__placeTime = "on";
})();
