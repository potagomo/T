/* ชั้นเว็บแอป: ตัดยอดเงินเดือนแบบสอนโรงเรียน — tools/update-lesson.py ฝังไฟล์นี้ไว้ท้าย lesson/index.html

   หน้ารายได้นับตามเดือนปฏิทิน แต่โรงเรียนตัดยอดเงินเดือนกลางเดือน (เช่น ตัดวันที่ 20 → เงินเดือน ต.ค. = 21 ก.ย.–20 ต.ค.)
   ยอดในแอปจึงเทียบกับสลิปโรงเรียนไม่ได้ ชั้นนี้:
     • แต่ละสถานที่ตั้ง "ตัดยอดทุกวันที่" ได้ (1–30 หรือสิ้นเดือน) เก็บที่ place.cutoff ซิงค์ไปกับสถานที่
       วันที่ 29–30 ในเดือนที่สั้นกว่า = วันสุดท้ายของเดือนนั้น
     • หน้ารายได้ (รายเดือน) มีส่วน "ตัดยอดเงินเดือนโรงเรียน": รอบที่จบในเดือนนั้นของแต่ละโรงเรียน ยอดตามแอป เทียบยอดที่โรงเรียนแจ้ง
       (รายปี: รวม 12 รอบ)
     • แตะเข้าไป: ใส่ยอดที่โรงเรียนแจ้ง → เห็นส่วนต่าง · ติ๊กออกคาบที่โรงเรียนไม่นับ · ใส่ยอดปรับ +/− พร้อมเหตุผล
       หรือกด "ใช้ยอดโรงเรียน" ให้ปรับส่วนที่เหลือให้ · "ได้รับจริง" = ยอดตามแอป (คาบที่นับ) + ยอดปรับ
     • ข้อมูลรอบเก็บที่ S.settings.payCuts["<placeId>|<YYYY-MM ของวันตัดยอด>"] = { reported, adj, note, off:[id คาบ], at }
   ตัวคาบ อัตรา และรายได้รวมของหน้ารายได้ไม่ถูกแก้ — ยอดปรับอยู่ในรอบตัดยอดเท่านั้น */
(function () {
  "use strict";
  var NEED = ["renderMoneyView", "showModal", "getPlace", "getPlaces", "lessonIncome", "lessonHours", "attInfo", "fmtMoney", "fmtHours", "monthLabel", "save"];
  var miss = NEED.filter(function (n) { return typeof window[n] !== "function"; });
  if (miss.length) { window.__payCut = "missing: " + miss.join(","); return; }

  var END = 31;                                                       // 31 = สิ้นเดือน
  function cutOf(p) { var c = parseInt(p && p.cutoff, 10); return c >= 1 && c < END ? c : END; }
  function pad(n) { return String(n).padStart(2, "0"); }
  function daysIn(y, m) { return new Date(y, m, 0).getDate(); }      // m = 1–12
  function ym(k) { var a = String(k).split("-"); return [parseInt(a[0], 10), parseInt(a[1], 10)]; }
  function shift(k, n) { var a = ym(k), t = a[0] * 12 + a[1] - 1 + n; return Math.floor(t / 12) + "-" + pad(t % 12 + 1); }
  function endOf(cut, k) { var a = ym(k); return a[0] + "-" + pad(a[1]) + "-" + pad(Math.min(cut, daysIn(a[0], a[1]))); }
  function nextDay(iso) { var d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + 1); return localISO(d); }
  // รอบเงินเดือนเดือน k (YYYY-MM) = วันถัดจากวันตัดยอดเดือนก่อน … วันตัดยอดเดือน k
  function cycle(cut, k) { return { key: k, start: nextDay(endOf(cut, shift(k, -1))), end: endOf(cut, k) }; }
  function cycleOfDate(cut, iso) { var k = iso.slice(0, 7); return iso <= endOf(cut, k) ? k : shift(k, 1); }
  function short(iso) { var a = iso.split("-"); return parseInt(a[2], 10) + " " + MO[parseInt(a[1], 10) - 1]; }
  function range(c) { return short(c.start) + " – " + short(c.end) + " " + (ym(c.end)[0] + 543); }
  function cutLabel(cut) { return cut >= END ? "สิ้นเดือน" : "วันที่ " + cut; }
  window.__payCycle = function (p, k) { return cycle(cutOf(p), k); };

  function store() { if (!S.settings.payCuts || typeof S.settings.payCuts !== "object") S.settings.payCuts = {}; return S.settings.payCuts; }
  function rid(pid, k) { return String(pid) + "|" + k; }
  function rec(pid, k) { return (S.settings.payCuts || {})[rid(pid, k)] || null; }
  function tidy(pid, k) {
    var r = rec(pid, k);
    if (r && r.reported == null && !num(r.adj, 0) && !r.note && !(r.off && r.off.length)) delete store()[rid(pid, k)];
  }

  function lessonsIn(pid, c) {
    return S.lessons.filter(function (l) { return l.kind === "school" && String(l.placeId) === String(pid) && l.date >= c.start && l.date <= c.end; })
      .sort(function (a, b) { return (a.date + (a.time || "")) < (b.date + (b.time || "")) ? -1 : 1; });
  }
  // ยอดของรอบ: คาบที่นับ (ไม่ได้ติ๊กออก) · รอยืนยัน · ยอดปรับ · ได้รับจริง
  function tally(pid, c) {
    var r = rec(pid, c.key) || {}, off = {}, t = { app: 0, n: 0, hours: 0, pend: 0, pendInc: 0, offN: 0, offInc: 0, list: [] };
    (r.off || []).forEach(function (id) { off[id] = 1; });
    lessonsIn(pid, c).forEach(function (l) {
      var inc = lessonIncome(l);
      t.list.push(l);
      if (l.attendance === "planned") { t.pend++; t.pendInc += lessonIncome(Object.assign({}, l, { attendance: "present" })); return; }
      if (off[l.id]) { t.offN++; t.offInc += inc; return; }
      t.app += inc; t.hours += lessonHours(l); if (attInfo(l.attendance).paid) t.n++;
    });
    t.adj = num(r.adj, 0); t.got = t.app + t.adj;
    t.reported = r.reported == null || r.reported === "" ? null : num(r.reported, 0);
    t.diff = t.reported == null ? null : t.reported - t.got;
    t.off = off; t.note = r.note || "";
    return t;
  }
  window.__payTally = function (pid, k) { var p = getPlace(pid); return tally(pid, cycle(cutOf(p), k)); };

  function signed(v) { return (v > 0 ? "+" : v < 0 ? "−" : "") + fmtMoney(Math.abs(v)); }
  function status(t) {
    if (t.reported == null) return '<span style="color:#5A5A5A;">ยังไม่ใส่ยอดโรงเรียน</span>';
    if (Math.abs(t.diff) < 0.5) return '<span style="color:#15803D;font-weight:700;">✓ ตรงกัน</span>';
    return '<span style="color:#B91C1C;font-weight:700;">' + (t.diff > 0 ? "โรงเรียนจ่ายมากกว่า " : "โรงเรียนจ่ายน้อยกว่า ") + fmtMoney(Math.abs(t.diff)) + '</span>';
  }

  /* ── หน้ารายได้: ส่วนตัดยอด ── */
  function schoolPlaces() {
    var f = S.sum && S.sum.place;
    if (f === "ส่วนตัว") return [];
    return getPlaces(true).filter(function (p) { return !f || f === "ทั้งหมด" || String(p.id) === String(f); });
  }
  function monthRows(k) {
    return schoolPlaces().map(function (p) {
      var c = cycle(cutOf(p), k), t = tally(p.id, c);
      if (!t.list.length && !rec(p.id, k)) return "";
      return '<button type="button" class="pc-row" onclick="openPayCut(' + jsArg(p.id) + ',' + jsArg(k) + ')" style="display:flex;width:100%;text-align:left;align-items:center;gap:12px;padding:12px 0;background:none;border:0;border-bottom:1px solid #000000;cursor:pointer;color:inherit;font:inherit;">' +
        '<div style="flex:1;min-width:0;"><div style="font-size:14px;font-weight:600;color:#000000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(p.name) + '</div>' +
          '<div class="mono" style="font-size:11px;color:#5A5A5A;margin-top:2px;">' + esc(range(c)) + ' · <span>ตัดยอด</span>' + esc(cutLabel(cutOf(p))) + '</div>' +
          '<div style="font-size:12.5px;margin-top:4px;">' + status(t) + '</div></div>' +
        '<div style="text-align:right;flex-shrink:0;"><div style="font-size:15px;font-weight:800;color:#1D4ED8;">' + fmtMoney(t.got) + '</div>' +
          '<div style="font-size:11px;color:#5A5A5A;">' + t.n + ' <span>คาบ</span>' + (t.adj ? ' · <span>ปรับ</span> ' + signed(t.adj) : '') + '</div></div>' +
        '<span aria-hidden="true" style="font-size:18px;color:#5A5A5A;">›</span></button>';
    }).join("");
  }
  function yearRows(y) {
    return schoolPlaces().map(function (p) {
      var got = 0, rep = 0, nrep = 0, any = false, last = null;
      for (var m = 1; m <= 12; m++) {
        var k = y + "-" + pad(m), t = tally(p.id, cycle(cutOf(p), k));
        if (!t.list.length && !rec(p.id, k)) continue;
        any = true; last = k; got += t.got;
        if (t.reported != null) { rep += t.reported; nrep++; }
      }
      if (!any) return "";
      return '<button type="button" class="pc-row" onclick="openPayCut(' + jsArg(p.id) + ',' + jsArg(last) + ')" style="display:flex;width:100%;text-align:left;align-items:center;gap:12px;padding:12px 0;background:none;border:0;border-bottom:1px solid #000000;cursor:pointer;color:inherit;font:inherit;">' +
        '<div style="flex:1;min-width:0;"><div style="font-size:14px;font-weight:600;color:#000000;">' + esc(p.name) + '</div>' +
          '<div style="font-size:12px;color:#5A5A5A;margin-top:2px;"><span>โรงเรียนแจ้งแล้ว</span> ' + nrep + ' <span>รอบ</span>' + (nrep ? ' · <span>รวมที่แจ้ง</span> ' + fmtMoney(rep) : '') + '</div></div>' +
        '<div style="font-size:15px;font-weight:800;color:#1D4ED8;flex-shrink:0;">' + fmtMoney(got) + '</div></button>';
    }).join("");
  }
  var origMoney = window.renderMoneyView;
  window.renderMoneyView = function () {
    var r = origMoney.apply(this, arguments);
    var host = document.getElementById("view-money");
    if (!host || !S.sum || !S.sum.period) return r;
    var rows = S.sum.mode === "month" ? monthRows(S.sum.period) : yearRows(S.sum.period);
    if (!rows) return r;
    var box = document.createElement("div");
    box.id = "paycut";
    box.innerHTML = '<div class="sectionhead"><span class="sectiontitle">ตัดยอดเงินเดือนโรงเรียน</span></div>' +
      '<div class="hint" style="margin:-4px 0 4px;">' + (S.sum.mode === "month" ? "รอบที่ตัดยอดในเดือนนี้ · แตะเพื่อเทียบกับยอดที่โรงเรียนแจ้ง" : "รวมรอบที่ตัดยอดในปีนี้") + '</div>' + rows;
    var anchor = host.querySelector(":scope > .sectionhead");
    host.insertBefore(box, anchor || null);
    return r;
  };

  /* ── หน้าเทียบยอดของรอบ ── */
  var PC = null, timer = null;
  function flush() { if (timer) { clearTimeout(timer); timer = null; save({ noSnap: true, noCount: true }); } }
  window.__payCutDone = function () { flush(); closeModal(); renderAll(); };
  function cutOptions(cut) {
    var o = "";
    for (var d = 1; d < END; d++) o += '<option value="' + d + '"' + (d === cut ? " selected" : "") + '>วันที่ ' + d + '</option>';
    return o + '<option value="' + END + '"' + (cut >= END ? " selected" : "") + '>สิ้นเดือน</option>';
  }
  window.openPayCut = function (pid, k) {
    var p = getPlace(isNaN(parseInt(pid, 10)) ? pid : parseInt(pid, 10)) || getPlace(pid);
    if (!p) return;
    if (!k) k = cycleOfDate(cutOf(p), todayStr());
    PC = { pid: p.id, k: k };
    draw();
  };
  function draw() {
    var p = getPlace(PC.pid); if (!p) return;
    var cut = cutOf(p), c = cycle(cut, PC.k), t = tally(p.id, c), r = rec(p.id, c.key) || {};
    var rows = t.list.map(function (l) {
      var a = attInfo(l.attendance), planned = l.attendance === "planned", inc = planned ? 0 : lessonIncome(l);
      return '<label class="tick pc-l" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(0,0,0,.15);' + (planned ? "opacity:.55;" : "") + '">' +
        '<span style="display:flex;align-items:center;gap:9px;min-width:0;"><input type="checkbox" data-id="' + l.id + '"' + (t.off[l.id] ? "" : " checked") + (planned ? " disabled" : "") + '>' +
          '<span style="min-width:0;"><span class="mono" style="font-size:12px;color:#5A5A5A;">' + esc(short(l.date)) + ' ' + esc(l.time || "") + '</span> ' +
          '<b style="font-weight:600;">' + esc(displayName(l.student)) + '</b> <span style="font-size:12px;color:' + a.color + ';">' + esc(a.short) + '</span></span></span>' +
        '<span style="flex-shrink:0;font-weight:700;' + (t.off[l.id] ? "text-decoration:line-through;color:#5A5A5A;" : "") + '">' + (planned ? "–" : fmtMoney(inc)) + '</span></label>';
    }).join("") || '<div class="empty" style="padding:24px 8px;">— ไม่มีคาบในรอบนี้ —</div>';
    showModal('<div class="mhead"><div class="mtitle">ตัดยอด · ' + esc(p.name) + '</div>' +
        '<button class="ib" type="button" onclick="__payCutDone()" aria-label="ปิด" style="font-size:19px;">✕</button></div>' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;"><label for="pc-cut" style="margin:0;flex-shrink:0;">ตัดยอดทุก</label>' +
        '<select id="pc-cut" style="flex:1;min-width:0;">' + cutOptions(cut) + '</select></div>' +
      '<div class="datenav" style="margin:0 0 12px;padding:3px;gap:2px;">' +
        '<button type="button" id="pc-prev" aria-label="รอบก่อนหน้า">‹</button>' +
        '<div style="flex:1;text-align:center;line-height:1.35;"><div style="font-weight:700;font-size:14.5px;color:#000000;"><span>เงินเดือน</span> ' + esc(monthLabel(c.key)) + '</div>' +
          '<div class="mono" style="font-size:11.5px;color:#5A5A5A;">' + esc(range(c)) + '</div></div>' +
        '<button type="button" id="pc-next" aria-label="รอบถัดไป">›</button></div>' +
      '<div id="pc-sum"></div>' +
      '<div style="display:flex;flex-direction:column;gap:12px;margin:12px 0 12px;">' +
        '<div><label for="pc-rep">ยอดที่โรงเรียนแจ้ง (บาท)</label><input id="pc-rep" type="number" inputmode="decimal" step="any" placeholder="ดูจากสลิป" value="' + (r.reported == null ? "" : esc(r.reported)) + '"></div>' +
        '<div><label for="pc-adj">ปรับยอด + / − (บาท)</label><input id="pc-adj" type="number" inputmode="decimal" step="any" placeholder="0" value="' + (num(r.adj, 0) ? esc(r.adj) : "") + '"></div></div>' +
      '<div><label for="pc-note">เหตุผลที่ปรับ (ไม่บังคับ)</label><input id="pc-note" placeholder="เช่น โรงเรียนหักภาษี 3% · ค่าเดินทาง" value="' + esc(r.note || "") + '"></div>' +
      '<div class="sectionhead" style="margin-top:16px;"><span class="sectiontitle">คาบในรอบนี้</span></div>' +
      '<div class="hint" style="margin:-4px 0 6px;">ติ๊กออกคาบที่โรงเรียนไม่นับ — แก้แค่ยอดของรอบนี้ ตัวคาบไม่เปลี่ยน</div>' +
      '<div id="pc-list">' + rows + '</div>' +
      '<button class="btn-g" type="button" onclick="__payCutDone()" style="width:100%;margin-top:14px;">เสร็จ</button>', "480px");
    summary();
    var q = function (id) { return document.getElementById(id); };
    q("pc-cut").addEventListener("change", function () {
      flush();
      var v = parseInt(this.value, 10), pl = getPlace(PC.pid);
      if (v >= END) delete pl.cutoff; else pl.cutoff = v;
      pl.updatedAt = nowISO();
      save();
      toast("ตัดยอด " + pl.name + " ทุก" + cutLabel(cutOf(pl)));
      draw();
    });
    q("pc-prev").addEventListener("click", function () { flush(); PC.k = shift(PC.k, -1); draw(); });
    q("pc-next").addEventListener("click", function () { flush(); PC.k = shift(PC.k, 1); draw(); });
    function put(field, v) {
      var s = store(), id = rid(PC.pid, PC.k), x = s[id] || (s[id] = {});
      if (v === null || v === "") delete x[field]; else x[field] = v;
      x.at = nowISO();
      tidy(PC.pid, PC.k);
      clearTimeout(timer); timer = setTimeout(function () { save({ noSnap: true, noCount: true }); }, 400);
      summary();
    }
    q("pc-rep").addEventListener("input", function () { put("reported", this.value === "" ? null : num(this.value, 0)); });
    q("pc-adj").addEventListener("input", function () { put("adj", this.value === "" ? null : num(this.value, 0)); });
    q("pc-note").addEventListener("input", function () { put("note", this.value.trim() || null); });
    Array.prototype.forEach.call(document.querySelectorAll("#pc-list input[data-id]"), function (cb) {
      cb.addEventListener("change", function () {
        var t0 = rec(PC.pid, PC.k), off = (t0 && t0.off || []).slice(), id = +this.dataset.id, i = off.indexOf(id);
        if (this.checked && i >= 0) off.splice(i, 1); else if (!this.checked && i < 0) off.push(id);
        var amt = this.closest("label").lastElementChild;
        amt.style.textDecoration = this.checked ? "" : "line-through"; amt.style.color = this.checked ? "" : "#5A5A5A";
        put("off", off.length ? off : null);
      });
    });
  }
  function summary() {
    var host = document.getElementById("pc-sum"); if (!host || !PC) return;
    var p = getPlace(PC.pid), c = cycle(cutOf(p), PC.k), t = tally(p.id, c);
    var line = function (a, b, st) { return '<div style="display:flex;justify-content:space-between;gap:10px;padding:5px 0;' + (st || "") + '"><span>' + a + '</span><span style="font-weight:700;text-align:right;white-space:nowrap;flex-shrink:0;">' + b + '</span></div>'; };
    host.innerHTML = '<div style="background:#FFFFFF;border:2px solid #000000;border-radius:3px;padding:12px 14px;">' +
      line('<span>ตามแอป</span> <span class="hint">' + t.n + ' <span>คาบ</span> · ' + esc(fmtHours(t.hours)) + '</span>', fmtMoney(t.app)) +
      (t.offN ? line('<span class="hint"><span>ติ๊กออก</span> ' + t.offN + ' <span>คาบ</span></span>', '<span class="hint">' + fmtMoney(t.offInc) + '</span>') : '') +
      (t.pend ? line('<span class="hint"><span>รอยืนยัน</span> ' + t.pend + ' <span>คาบ (ยังไม่รวม)</span></span>', '<span class="hint">' + fmtMoney(t.pendInc) + '</span>') : '') +
      (t.adj ? line('<span>ปรับยอด</span>' + (t.note ? ' <span class="hint">' + esc(t.note) + '</span>' : ''), signed(t.adj)) : '') +
      line('<b>ได้รับจริง</b>', '<span style="font-size:18px;color:#1D4ED8;">' + fmtMoney(t.got) + '</span>', 'border-top:2px solid #000000;margin-top:4px;padding-top:8px;') +
      (t.reported != null ? line('<span>โรงเรียนแจ้ง</span>', fmtMoney(t.reported)) : '') +
      '<div id="pc-status" style="margin-top:6px;font-size:13.5px;">' + status(t) + '</div>' +
      (t.reported != null && Math.abs(t.diff) >= 0.5 ? '<button class="btn-brass" type="button" id="pc-use" style="width:100%;margin-top:10px;">ใช้ยอดโรงเรียน (ปรับ ' + signed(t.diff) + ')</button>' : '') +
      '</div>';
    var use = document.getElementById("pc-use");
    if (use) use.addEventListener("click", function () {
      var tt = tally(PC.pid, cycle(cutOf(getPlace(PC.pid)), PC.k)), adj = Math.round((tt.adj + tt.diff) * 100) / 100;
      var inp = document.getElementById("pc-adj");
      if (inp) { inp.value = adj || ""; inp.dispatchEvent(new Event("input")); }
      var note = document.getElementById("pc-note");
      if (note && !note.value.trim()) { note.value = "ปรับตามยอดโรงเรียน"; note.dispatchEvent(new Event("input")); }
      toast("ปรับยอดรอบนี้ตามที่โรงเรียนแจ้งแล้ว");
    });
  }

  /* ── หน้าแก้สถานที่สอน: ช่องวันตัดยอด ── */
  if (typeof window.showPlaceModal === "function") {
    var origPlace = window.showPlaceModal;
    window.showPlaceModal = function () {
      var r = origPlace.apply(this, arguments);
      var after = document.getElementById("pf-dur") || document.getElementById("pf-pay-ex");
      if (after && !document.getElementById("pf-cut") && window.PF) {
        var box = document.createElement("div"); box.id = "pf-cut";
        box.innerHTML = '<label for="pf-cut-sel">ตัดยอดเงินเดือนทุก</label><select id="pf-cut-sel">' + cutOptions(cutOf(PF)) + '</select>' +
          '<div class="hint" style="margin-top:4px;">ใช้แบ่งรอบในหน้ารายได้ › ตัดยอดเงินเดือนโรงเรียน (เทียบกับยอดที่โรงเรียนแจ้ง)</div>';
        after.parentNode.insertBefore(box, after.nextSibling);
        box.querySelector("select").addEventListener("change", function () { var v = parseInt(this.value, 10); PF.cutoff = v >= END ? null : v; });   // null (ไม่ใช่ลบ) — updatePlace คัดลอกเฉพาะคีย์ที่มี
      }
      return r;
    };
  }
  window.__payCut = "on";
})();
