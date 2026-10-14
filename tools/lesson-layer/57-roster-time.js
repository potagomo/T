/* ชั้นเว็บแอป: เวลาของตารางประจำตามข้อความที่วาง — tools/update-lesson.py ฝังไฟล์นี้ไว้ท้าย lesson/index.html

   ตารางประจำสัปดาห์ใส่เวลาได้แบบไม่บังคับ ถ้าเว้นว่าง แอปลงคาบล่วงหน้าให้ที่ 10:00 ทุกคน → คาบทับกันหมด
   (เช่น harvey พฤหัส 16:00 · โค้ช 17:00 ตามข้อความโรงเรียน แต่คาบอัตโนมัติขึ้น 10:00 ทั้งคู่)
   ชั้นนี้:
     • ตารางประจำที่ไม่มีเวลา (หรือเวลาที่ได้จากข้อความ) ใช้เวลาจาก "คาบที่มาจากการวางตาราง" ล่าสุดของนักเรียนคนนั้น
       วันเดียวกันในสัปดาห์ ประเภทเดียวกัน (สถานที่เดียวกัน) แล้วจดเวลานั้นไว้ในตารางประจำ (timeFrom = "paste")
     • คาบล่วงหน้าที่ระบบลงไว้ด้วยเวลาเดาเดิม (ยังไม่ได้ยืนยัน หรือเป็นวันนี้/วันหน้า) เปลี่ยนเวลาตาม
     • วางตารางครั้งต่อไป: ตารางประจำที่ได้เวลาจากข้อความ ตามเวลาใหม่ในข้อความ · เลิกทำ (undo) ย้อนตารางประจำด้วย
     • เวลาที่ครูตั้งเองในตารางประจำ หรือเลือก "ทุกสัปดาห์ต่อจากนี้" ไม่ถูกเปลี่ยนเอง
   ทำตอนเปิดแอปครั้งแรกหลังอัปเดต (แก้ข้อมูลเดิมที่ทับกันอยู่) และทุกครั้งที่วางตาราง */
(function () {
  "use strict";
  var NEED = ["lessonFromRosterEntry", "applyImport", "migrate", "normTime", "todayStr", "save", "startApp"];
  var miss = NEED.filter(function (n) { return typeof window[n] !== "function"; });
  if (miss.length) { window.__rosterTime = "missing: " + miss.join(","); return; }

  var PLACEHOLDER = "10:00";                                  // เวลาที่แอปเดาให้ตารางประจำที่ไม่มีเวลา (lessonFromRosterEntry)
  function hhmm(t) { var v = normTime(t); return /^\d\d:\d\d$/.test(v) ? v : ""; }
  function lessonsOf(k) { return window.__lessonsOf ? __lessonsOf(k) : S.lessons.filter(function (l) { return l.student === k; }); }
  function wday(iso) { return new Date(iso + "T00:00:00").getDay(); }
  function learnable(e) { return !e.time || e.timeFrom === "paste"; }

  // เวลาจากข้อความที่วางล่าสุด สำหรับตารางประจำช่องนี้ (null = ไม่มีหลักฐาน / กำกวม)
  function pastedTime(e) {
    var twins = S.schedule.filter(function (x) { return x.student === e.student && x.day === e.day && (x.kind || "school") === (e.kind || "school"); });
    if (twins.length > 1) return null;                         // คนเดียวเรียน 2 ช่องในวันเดียวกัน — บอกไม่ได้ว่าข้อความหมายถึงช่องไหน
    var best = null;
    lessonsOf(e.student).forEach(function (l) {
      if (!l.importedAt || !l.date || (l.kind || "school") !== (e.kind || "school") || wday(l.date) !== e.day) return;
      if (e.kind !== "private" && e.placeId != null && l.placeId != null && String(l.placeId) !== String(e.placeId)) return;
      var t = hhmm(l.time); if (!t) return;
      if (!best || l.date > best.date || (l.date === best.date && String(l.importedAt) > String(best.importedAt))) best = { date: l.date, importedAt: l.importedAt, time: t };
    });
    return best && best.time;
  }

  var LAST = null;                                             // การเปลี่ยนครั้งล่าสุด (ไว้ย้อนตอนเลิกทำการวางตาราง)
  function learn() {
    var t0 = todayStr(), changes = [];
    (S.schedule || []).forEach(function (e) {
      if (!learnable(e)) return;
      var t = pastedTime(e);
      if (!t || t === e.time) return;
      var old = e.time ? hhmm(e.time) : PLACEHOLDER, ch = { e: e, time: e.time, timeFrom: e.timeFrom, lessons: [] };
      e.time = t; e.timeFrom = "paste";
      S.lessons.forEach(function (l) {
        if (l.rosterId !== e.id || !l.auto || hhmm(l.time) !== old) return;
        if (l.attendance !== "planned" && l.date < t0) return;  // คาบที่ผ่านไปแล้วและยืนยันแล้ว = ประวัติ ไม่แก้
        ch.lessons.push({ l: l, time: l.time });
        l.time = t; l.updatedAt = nowISO();
      });
      changes.push(ch);
    });
    return changes;
  }
  window.__rosterLearn = learn;

  // ตารางประจำที่ยังไม่มีเวลา: คาบที่ลงใหม่ใช้เวลาจากข้อความเลย (ไม่ใช่ 10:00)
  var origFromRoster = window.lessonFromRosterEntry;
  window.lessonFromRosterEntry = function (e) {
    var l = origFromRoster.apply(this, arguments);
    if (l && e && !e.time) { var t = pastedTime(e); if (t) l.time = t; }
    return l;
  };

  /* ── วางตาราง: คาบที่ถูกเลื่อนเวลานับเป็นข้อมูลจากข้อความด้วย แล้วปรับตารางประจำ ── */
  var IMP = null;
  var origApply = window.applyImport;
  window.applyImport = function () {
    IMP = { at: nowISO(), until: Date.now() + 60000, times: {} };
    S.lessons.forEach(function (l) { IMP.times[l.id] = hhmm(l.time); });
    return origApply.apply(this, arguments);
  };
  var origMigrate = window.migrate;
  window.migrate = function () {
    var r = origMigrate.apply(this, arguments);
    if (IMP && Date.now() < IMP.until) {
      var imp = IMP, marked = []; IMP = null;
      S.lessons.forEach(function (l) {
        if (l.id in imp.times && imp.times[l.id] !== hhmm(l.time) && !l.importedAt) { l.importedAt = imp.at; marked.push(l); }   // เลื่อนเวลาตามข้อความ
      });
      var ch = learn();
      LAST = { at: imp.at, changes: ch, marked: marked };
    }
    return r;
  };
  if (typeof window.undoImport === "function") {
    var origUndo = window.undoImport;
    window.undoImport = function () {
      var last = LAST; LAST = null;
      if (last) {
        last.changes.forEach(function (c) {
          c.e.time = c.time; if (c.timeFrom === undefined) delete c.e.timeFrom; else c.e.timeFrom = c.timeFrom;
          c.lessons.forEach(function (x) { x.l.time = x.time; });
        });
        last.marked.forEach(function (l) { delete l.importedAt; });
      }
      return origUndo.apply(this, arguments);
    };
  }

  /* ── ครูตั้งเวลาเอง = ไม่ตามข้อความอีก ── */
  if (typeof window.updateScheduleEntry === "function") {
    var origUpd = window.updateScheduleEntry;
    window.updateScheduleEntry = function (id, patch) {
      var e = (S.schedule || []).find(function (x) { return x.id === id; });
      if (e && patch && patch.time !== undefined && hhmm(patch.time) !== hhmm(e.time)) { patch = Object.assign({}, patch); delete patch.timeFrom; delete e.timeFrom; }
      return origUpd.call(this, id, patch);
    };
  }
  if (typeof window.rosterApplyFromNow === "function") {
    var origFromNow = window.rosterApplyFromNow;
    window.rosterApplyFromNow = function (lessonId) {
      var l = S.lessons.find(function (x) { return x.id === lessonId; }), e = l && (S.schedule || []).find(function (x) { return x.id === l.rosterId; });
      if (e) delete e.timeFrom;
      return origFromNow.apply(this, arguments);
    };
  }

  /* ── เปิดแอป: แก้ตารางประจำที่ยังไม่มีเวลา (คาบล่วงหน้าที่ทับกันอยู่ 10:00) ── */
  var origStart = window.startApp;
  window.startApp = function () {
    var r = origStart.apply(this, arguments);
    setTimeout(function () {
      try {
        var ch = learn();
        if (!ch.length) return;
        save(); if (typeof renderAll === "function") renderAll();
        var n = ch.reduce(function (s, c) { return s + c.lessons.length; }, 0);
        toast("ตั้งเวลาตารางประจำ " + ch.length + " คนตามข้อความที่วางไว้" + (n ? " · คาบล่วงหน้าเปลี่ยนเวลาตาม " + n + " คาบ" : ""));
      } catch (e) {}
    }, 500);
    return r;
  };
  window.__rosterTime = "on";
})();
