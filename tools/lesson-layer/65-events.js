/* ชั้นเว็บแอป: งานสำคัญ (นับถอยหลัง) — tools/update-lesson.py ฝังไฟล์นี้ไว้ท้าย lesson/index.html

   ครูตั้งงานสำคัญได้ (คอนเสิร์ต สอบเกรด แข่งขัน …) พร้อมวัน เวลา สถานที่
   นับถอยหลังแบบ "ยิ่งใกล้ยิ่งละเอียด": ไกล = เดือน + สัปดาห์ › ใกล้ = สัปดาห์ + วัน › วัน + ชั่วโมง › 2 วันสุดท้ายเป็นนาฬิกาเดินทีละวินาที
   ใต้ตัวเลขใหญ่มีช่อง เดือน › สัปดาห์ › วัน › เวลา ให้เห็นภาพรวม และแถบความคืบหน้าตั้งแต่วันที่สร้างงาน

   เลือกนักเรียนที่เข้าร่วมได้ (ติ๊กเร็ว ๆ ค้นชื่อ กรองตามสถานที่ เลือกทั้งหมดที่เห็น) ถอนออกได้ตลอด แม้งานผ่านไปแล้ว
   แต่ละคนบอกว่า "เรียนอีกกี่ครั้งก่อนวันงาน" นับจาก
     คาบที่ลงไว้แล้ว (รอยืนยัน/มาเรียน ที่ยังไม่ถึงเวลา) + ตารางประจำสัปดาห์ที่ยังไม่ได้ลง
     (ข้ามวันหยุดที่ตั้งไว้ · ข้ามวันที่กดข้ามในตารางประจำ · วันงานนับเฉพาะคาบก่อนเวลางาน)
   ไม่มีตารางเลย: ประมาณจากที่มาเรียนจริงใน 8 สัปดาห์ล่าสุด (ขึ้น ≈)

   อยู่ที่: แท็บภาพรวม (บนสุด การ์ดใหญ่) · หน้าวันนี้ (แถบเล็กของงานที่ใกล้ที่สุด) · ⚙ › การสอน › 🎯 งานสำคัญ
   · หน้านักเรียน (งานที่น้องเข้าร่วม + ติ๊กเข้าร่วม/ถอนได้ทันที)
   เก็บใน S.settings.events — ซิงค์ข้ามเครื่องและอยู่ในไฟล์สำรอง/ประวัติย้อนหลังไปพร้อมการตั้งค่า */
(function () {
  "use strict";
  var NEED = ["showModal", "closeModal", "renderOverviewView", "festBannerHtml", "save", "toast", "esc", "addDays", "todayStr", "displayName", "avatarHtml"];
  var miss = NEED.filter(function (n) { return typeof window[n] !== "function"; });
  if (miss.length) { window.__events = "missing: " + miss.join(","); return; }

  function EN() { return window.__i18n === "en"; }
  function T(th, en) { return EN() ? en : th; }
  var MO_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var DA_TH = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."], DA_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var EMOJI = ["🎤", "🥁", "🏆", "🎓", "🎉", "🎬", "⭐", "📅"];

  /* ── ข้อมูล ── */
  function list() {
    if (!Array.isArray(S.settings.events)) S.settings.events = [];
    S.settings.events = S.settings.events.filter(function (e) { return e && typeof e === "object" && e.id != null && e.date; });
    S.settings.events.forEach(function (e) { if (!Array.isArray(e.students)) e.students = []; });
    return S.settings.events;
  }
  function byId(id) { return list().filter(function (e) { return String(e.id) === String(id); })[0] || null; }
  function startOf(ev) { return new Date(ev.date + "T" + (ev.time || "00:00") + ":00"); }
  function sameDay(ev) { return ev.date === todayStr(); }
  function isPast(ev) { return ev.date < todayStr(); }
  function sorted() {
    var t = todayStr();
    var up = list().filter(function (e) { return e.date >= t; }).sort(function (a, b) { return startOf(a) - startOf(b); });
    var past = list().filter(function (e) { return e.date < t; }).sort(function (a, b) { return startOf(b) - startOf(a); });
    return { up: up, past: past };
  }
  function persist() { save(); }
  function fmtDay(d) {
    var dt = new Date(d + "T00:00:00");
    return EN() ? DA_EN[dt.getDay()] + " " + dt.getDate() + " " + MO_EN[dt.getMonth()] + " " + dt.getFullYear()
                : DA_TH[dt.getDay()] + " " + dt.getDate() + " " + MO[dt.getMonth()] + " " + (dt.getFullYear() + 543);
  }
  // สถานที่เป็นข้อความที่ครูพิมพ์ — ไม่ให้ตัวแปลภาษาแตะ
  function whenHtml(ev) { return esc(fmtDay(ev.date) + (ev.time ? " · " + ev.time + T(" น.", "") : "")) + (ev.place ? ' · <span data-noi18n>' + esc(ev.place) + '</span>' : ""); }

  /* ── นับถอยหลัง ── */
  function addMonths(d, k) {
    var r = new Date(d.getFullYear(), d.getMonth() + k, 1, d.getHours(), d.getMinutes(), d.getSeconds());
    var last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
    r.setDate(Math.min(d.getDate(), last));
    return r;
  }
  function parts(ev, now) {
    var target = startOf(ev), ms = target - now;
    if (ms <= 0) return null;
    var m = 0;
    while (m < 240 && addMonths(now, m + 1) <= target) m++;
    var rem = target - addMonths(now, m);
    var days = Math.floor(rem / 864e5), r2 = rem - days * 864e5;
    return { ms: ms, total: ms / 864e5, m: m, w: Math.floor(days / 7), d: days % 7,
             h: Math.floor(r2 / 36e5), mi: Math.floor((r2 % 36e5) / 6e4), s: Math.floor((r2 % 6e4) / 1000) };
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function U(n, th, en, ens) { return [n, EN() ? (n === 1 ? en : ens) : th]; }
  // ตัวเลขใหญ่: ยิ่งใกล้ยิ่งละเอียด
  function headline(ev, now) {
    var p = parts(ev, now);
    if (!p) {
      if (sameDay(ev)) return { done: true, text: T("วันนี้! 🎉", "Today! 🎉"), units: [] };
      var ago = Math.max(1, Math.round((new Date(todayStr() + "T00:00:00") - new Date(ev.date + "T00:00:00")) / 864e5));
      return { done: true, past: true, text: T("ผ่านมาแล้ว " + ago + " วัน", ago + (ago === 1 ? " day ago" : " days ago")), units: [] };
    }
    var td = Math.floor(p.total), th = Math.floor((p.ms % 864e5) / 36e5);
    if (p.total >= 60) return { units: [U(p.m, "เดือน", "month", "months")].concat(p.w ? [U(p.w, "สัปดาห์", "week", "weeks")] : p.d ? [U(p.d, "วัน", "day", "days")] : []) };
    if (p.total >= 14) { var w = Math.floor(td / 7), d = td % 7; return { units: [U(w, "สัปดาห์", "week", "weeks")].concat(d ? [U(d, "วัน", "day", "days")] : []) }; }
    if (p.total >= 2) return { units: [U(td, "วัน", "day", "days")].concat(th ? [U(th, "ชม.", "hr", "hrs")] : []) };
    var hh = Math.floor(p.ms / 36e5);
    return { clock: true, text: pad(hh) + ":" + pad(p.mi) + ":" + pad(p.s), units: [] };
  }
  function bigHtml(ev, now) {
    var h = headline(ev, now);
    if (h.text) return '<span class="ev-clock' + (h.clock ? ' tick' : '') + '">' + esc(h.text) + '</span>' + (h.clock ? '<span class="ev-u">' + T("ชม. : นาที : วินาที", "hrs : min : sec") + '</span>' : '');
    return T('<span class="ev-u">อีก</span>', '<span class="ev-u">in</span>') +
      h.units.map(function (u) { return '<b>' + u[0] + '</b><span class="ev-u">' + esc(u[1]) + '</span>'; }).join("");
  }
  function shortText(ev, now) {
    var h = headline(ev, now);
    if (h.text) return h.text;
    return T("อีก ", "in ") + h.units.map(function (u) { return u[0] + " " + u[1]; }).join(" ");
  }
  // ช่องภาพรวม เดือน › สัปดาห์ › วัน › เวลา (หน่วยที่เป็นศูนย์ด้านหน้าจางลง)
  function tilesHtml(ev, now) {
    var p = parts(ev, now);
    if (!p) return "";
    var lead = true;
    var cells = [[p.m, T("เดือน", "months")], [p.w, T("สัปดาห์", "weeks")], [p.d, T("วัน", "days")],
                 [pad(p.h) + ":" + pad(p.mi) + (p.total < 2 ? ":" + pad(p.s) : ""), T("เวลา", "time")]];
    return cells.map(function (c, i) {
      var zero = i < 3 && c[0] === 0 && lead; if (!zero) lead = false;
      return '<div class="ev-tile' + (zero ? ' z' : '') + '"><b>' + c[0] + '</b><span>' + c[1] + '</span></div>';
    }).join("");
  }
  function progress(ev, now) {
    var a = ev.createdAt ? new Date(ev.createdAt).getTime() : NaN, b = startOf(ev).getTime();
    if (!(a < b)) return 0;
    return Math.max(0, Math.min(100, Math.round((now - a) / (b - a) * 100)));
  }

  /* ── นักเรียน: อีกกี่ครั้งก่อนวันงาน ── */
  function hm(d) { return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function counts(ev) {
    var now = new Date(), today = todayStr(), nowHM = hm(now), end = ev.date, endHM = ev.time || "";
    var keys = ev.students.slice(), want = {}; keys.forEach(function (k) { want[k] = 1; });
    var booked = {}, kinds = {}, hist = {}, cut = addDays(today, -56);
    S.lessons.forEach(function (l) {
      if (!want[l.student] || !l.date) return;
      if (l.date >= today && l.date <= end) {
        var k2 = l.student + "|" + l.date;
        (kinds[k2] = kinds[k2] || {})[l.kind || "school"] = 1;
        (booked[k2] = booked[k2] || []).push(l);
      }
      if (l.attendance === "present" && l.date >= cut && l.date <= today) hist[l.student] = (hist[l.student] || 0) + 1;
    });
    var sched = {}; (S.schedule || []).forEach(function (e) { if (want[e.student]) (sched[e.student] = sched[e.student] || []).push(e); });
    function inWindow(d, t) {
      if (d === today && t && t <= nowHM) return false;
      if (d === end) return !!endHM && !!t && t < endHM;
      return true;
    }
    var out = keys.map(function (key) {
      var n = 0, first = null, last = null, es = sched[key] || [];
      if (end >= today) {
        for (var d = today, guard = 0; d <= end && guard < 1200; d = addDays(d, 1), guard++) {
          var got = 0, k2 = key + "|" + d;
          (booked[k2] || []).forEach(function (l) {
            if ((l.attendance === "planned" || l.attendance === "present") && inWindow(d, l.time)) got++;
          });
          if (es.length) {
            var wd = new Date(d + "T00:00:00").getDay();
            es.forEach(function (e) {
              if (e.day !== wd || (kinds[k2] && kinds[k2][e.kind || "school"])) return;
              if (typeof isClosedDate === "function" && isClosedDate(d, e.kind || "school")) return;
              if (typeof rosterSkipped === "function" && rosterSkipped(e.id, d)) return;
              if (inWindow(d, e.time)) got++;
            });
          }
          if (got) { n += got; if (!first) first = d; last = d; }
        }
      }
      var est = null;
      if (!n && !es.length && end >= today && hist[key]) {
        var weeks = (new Date(end + "T00:00:00") - new Date(today + "T00:00:00")) / (7 * 864e5);
        est = Math.round(hist[key] / 8 * weeks);
      }
      var slots = es.slice().sort(function (a, b) { return (a.day - b.day) || String(a.time).localeCompare(String(b.time)); })
        .map(function (e) { return (EN() ? DA_EN : DA_TH)[e.day] + " " + (e.time || ""); });
      return { key: key, n: n, est: est, first: first, last: last, slots: slots, past: end < today };
    });
    out.sort(function (a, b) { return (a.est != null ? a.est : a.n) - (b.est != null ? b.est : b.n) || displayName(a.key).localeCompare(displayName(b.key), "th"); });
    return out;
  }
  function countText(c) {
    if (c.past) return T("งานผ่านไปแล้ว", "Event has passed");
    if (c.est != null) return T("≈ " + c.est + " ครั้ง (ประมาณจากที่มาเรียนช่วงหลัง)", "≈ " + c.est + " lessons (estimated from recent attendance)");
    if (!c.n) return T("ไม่มีคาบก่อนวันงาน", "No lessons before the event");
    return T("เรียนอีก " + c.n + " ครั้ง", c.n + (c.n === 1 ? " more lesson" : " more lessons"));
  }
  window.__eventCounts = function (id) { var ev = byId(id); return ev ? counts(ev) : null; };

  /* ── หน้าตา ── */
  var css = document.createElement("style");
  css.textContent =
    ".ev-card{display:block;width:100%;text-align:left;background:#FFFDF5;border:2px solid #000;border-radius:3px;box-shadow:4px 4px 0 #000;padding:14px 14px 12px;margin-bottom:14px;color:#000;cursor:pointer;font:inherit;}" +
    ".ev-card.past{opacity:.6;box-shadow:2px 2px 0 #000;}" +
    ".ev-top{display:flex;align-items:center;gap:10px;}" +
    ".ev-emo{font-size:28px;line-height:1;flex-shrink:0;}" +
    ".ev-title{font-size:16px;font-weight:700;line-height:1.3;}" +
    ".ev-when{font-size:12px;color:#5A5A5A;margin-top:2px;}" +
    ".ev-big{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 8px;margin:12px 0 10px;}" +
    ".ev-big b{font-size:44px;line-height:1;font-weight:800;letter-spacing:-1px;}" +
    ".ev-big .ev-u{font-size:15px;font-weight:600;color:#2B2B2B;}" +
    ".ev-big .ev-clock{font-size:40px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;}" +
    ".ev-big .ev-clock.tick{color:#B91C1C;}" +
    ".ev-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;}" +
    ".ev-tile{border:2px solid #000;border-radius:3px;background:#fff;text-align:center;padding:6px 2px;}" +
    ".ev-tile b{display:block;font-size:clamp(13px,3.9vw,18px);font-variant-numeric:tabular-nums;white-space:nowrap;}" +
    ".ev-tile span{font-size:11px;color:#5A5A5A;}" +
    ".ev-tile.z{opacity:.35;}" +
    ".ev-bar{height:8px;border:2px solid #000;border-radius:3px;background:#fff;margin-top:10px;overflow:hidden;}" +
    ".ev-bar i{display:block;height:100%;background:var(--yel,#FFD93D);}" +
    ".ev-foot{font-size:12.5px;color:#2B2B2B;margin-top:8px;line-height:1.6;}" +
    ".ev-mini{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:2px solid #000;border-radius:3px;background:#FFFDF5;padding:10px 12px;margin-bottom:12px;font:inherit;color:#000;cursor:pointer;min-height:48px;}" +
    ".ev-mini b{font-variant-numeric:tabular-nums;}" +
    ".ev-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid rgba(0,0,0,.15);}" +
    ".ev-row:last-child{border-bottom:none;}" +
    ".ev-row .ev-n{font-size:20px;font-weight:800;min-width:34px;text-align:right;font-variant-numeric:tabular-nums;}" +
    ".ev-pick{display:flex;align-items:center;gap:10px;padding:8px 6px;border-bottom:1px solid rgba(0,0,0,.12);cursor:pointer;min-height:52px;}" +
    ".ev-pick input{width:22px;height:22px;min-height:0;padding:0;margin:0;flex-shrink:0;accent-color:#000;-webkit-appearance:checkbox;appearance:auto;}" +
    "#ev-sec{grid-column:1 / -1;}" +
    ".ev-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:0 14px;align-items:start;}" +
    ".ev-pick.on{background:rgba(255,217,61,.25);}" +
    ".ev-chips{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0;}" +
    ".ev-chips button{border:2px solid #000;border-radius:999px;background:#fff;padding:5px 11px;font:inherit;font-size:12.5px;min-height:34px;}" +
    ".ev-chips button.on{background:#000;color:var(--yel,#FFD93D);}" +
    ".ev-emos{display:flex;gap:6px;flex-wrap:wrap;}" +
    ".ev-emos button{font-size:22px;width:44px;height:44px;border:2px solid #000;border-radius:3px;background:#fff;}" +
    ".ev-emos button.on{background:var(--yel,#FFD93D);}";
  document.head.appendChild(css);

  function cardHtml(ev, now) {
    var c = counts(ev), past = isPast(ev);
    var foot = "";
    if (c.length) {
      var low = c[0], total = c.reduce(function (s, x) { return s + (x.est != null ? x.est : x.n); }, 0);
      foot = T("นักเรียน " + c.length + " คน", c.length + (c.length === 1 ? " student" : " students")) +
        (past ? "" : " · " + T("รวมเรียนอีก " + total + " ครั้ง", total + " lessons to go in total") +
          " · " + T("น้อยสุด ", "fewest: ") + '<span data-noi18n>' + esc(displayName(low.key)) + '</span> ' + (low.est != null ? "≈" + low.est : low.n) + T(" ครั้ง", ""));
    } else foot = T("ยังไม่ได้เลือกนักเรียน — แตะเพื่อเลือก", "No students yet — tap to choose");
    return '<button type="button" class="ev-card' + (past ? ' past' : '') + '" data-ev-open="' + esc(ev.id) + '">' +
      '<div class="ev-top"><span class="ev-emo">' + esc(ev.emoji || "🎯") + '</span><div style="min-width:0;flex:1;"><div class="ev-title" data-noi18n>' + esc(ev.title) + '</div>' +
        '<div class="ev-when">' + whenHtml(ev) + '</div></div></div>' +
      '<div class="ev-big" data-evcd="' + esc(ev.id) + '">' + bigHtml(ev, now) + '</div>' +
      (past ? '' : '<div class="ev-tiles" data-evtiles="' + esc(ev.id) + '">' + tilesHtml(ev, now) + '</div>' +
        '<div class="ev-bar"><i style="width:' + progress(ev, now) + '%"></i></div>') +
      '<div class="ev-foot">' + foot + '</div></button>';
  }
  function sectionHtml() {
    var s = sorted(), now = new Date();
    return '<div class="ovsec" id="ev-sec"><h3>🎯 ' + T("งานสำคัญ", "Key events") + '</h3>' +
      '<div class="ev-grid">' + s.up.map(function (e) { return cardHtml(e, now); }).join("") + '</div>' +
      '<button class="btn-g" type="button" data-ev-new style="width:100%;margin-bottom:' + (s.past.length ? 10 : 0) + 'px;">+ ' + T("เพิ่มงานสำคัญ (นับถอยหลัง)", "Add a key event (countdown)") + '</button>' +
      (s.past.length ? '<details class="more"><summary>' + T("งานที่ผ่านมา (" + s.past.length + ")", "Past events (" + s.past.length + ")") + '</summary><div style="padding-top:10px;">' +
        '<div class="ev-grid">' + s.past.map(function (e) { return cardHtml(e, now); }).join("") + '</div></div></details>' : '') + '</div>';
  }

  /* ── จุดที่แสดง ── */
  var origOv = window.renderOverviewView;
  window.renderOverviewView = function () {
    var r = origOv.apply(this, arguments);
    var wrap = document.querySelector("#view-overview .ovwrap");
    if (wrap && !document.getElementById("ev-sec")) {
      var box = document.createElement("div"); box.innerHTML = sectionHtml();
      var seg = wrap.querySelector(".seg");
      wrap.insertBefore(box.firstChild, seg ? seg : wrap.firstChild);
    }
    return r;
  };
  var origFest = window.festBannerHtml;
  window.festBannerHtml = function () {
    var up = sorted().up, html = "";
    if (up.length) {
      var ev = up[0];
      html = '<button type="button" class="ev-mini" data-ev-open="' + esc(ev.id) + '"><span style="font-size:22px;">' + esc(ev.emoji || "🎯") + '</span>' +
        '<span style="flex:1;min-width:0;"><span data-noi18n style="font-weight:700;">' + esc(ev.title) + '</span> · <b data-evmini="' + esc(ev.id) + '">' + esc(shortText(ev, new Date())) + '</b>' +
        (up.length > 1 ? '<span class="hint"> · ' + T("+ อีก " + (up.length - 1) + " งาน", "+ " + (up.length - 1) + " more") + '</span>' : '') + '</span><span>›</span></button>';
    }
    return html + origFest.apply(this, arguments);
  };

  // นาฬิกา: อัปเดตตัวเลขที่อยู่บนจอ (วินาทีละครั้งเฉพาะตอนที่มีนาฬิกาเดิน ไม่งั้นนาทีละครั้ง)
  var lastMin = -1;
  setInterval(function () {
    var els = document.querySelectorAll("[data-evcd],[data-evmini],[data-evtiles]");
    if (!els.length || document.hidden) return;
    var now = new Date(), minute = Math.floor(now / 6e4), fine = false;
    Array.prototype.forEach.call(els, function (el) {
      var ev = byId(el.getAttribute("data-evcd") || el.getAttribute("data-evmini") || el.getAttribute("data-evtiles"));
      if (!ev) return;
      var p = parts(ev, now); if (p && p.total < 2) fine = true;
    });
    if (!fine && minute === lastMin) return;
    lastMin = minute;
    Array.prototype.forEach.call(els, function (el) {
      var id = el.getAttribute("data-evcd") || el.getAttribute("data-evmini") || el.getAttribute("data-evtiles"), ev = byId(id);
      if (!ev) return;
      var html = el.hasAttribute("data-evcd") ? bigHtml(ev, now) : el.hasAttribute("data-evtiles") ? tilesHtml(ev, now) : esc(shortText(ev, now));
      if (el.innerHTML !== html) el.innerHTML = html;
    });
  }, 1000);

  /* ── หน้างาน ── */
  var CUR = null;
  function openEvent(id) {
    var ev = byId(id); if (!ev) return;
    CUR = ev.id;
    var now = new Date(), c = counts(ev);
    var rows = c.length ? c.map(function (x) {
      var sub = countText(x) + (x.n && x.last ? T(" · ครั้งสุดท้าย ", " · last ") + fmtDay(x.last) : "") +
        (x.slots.length ? T(" · ตาราง ", " · schedule ") + x.slots.join(", ") : "");
      return '<div class="ev-row">' + avatarHtml(displayName(x.key), S.photos[x.key], 38) +
        '<div style="flex:1;min-width:0;"><div style="font-weight:700;" data-noi18n>' + esc(displayName(x.key)) + '</div><div class="hint">' + esc(sub) + '</div></div>' +
        '<span class="ev-n">' + (x.past ? "" : x.est != null ? "≈" + x.est : x.n) + '</span>' +
        '<button class="ib" type="button" data-ev-out="' + esc(x.key) + '" aria-label="' + T("ถอนออก", "Remove") + '" title="' + T("ถอนออก", "Remove") + '" style="font-size:16px;">✕</button></div>';
    }).join("") : '<div class="empty" style="padding:22px 10px;">' + T("ยังไม่มีนักเรียนในงานนี้", "No students in this event yet") + '</div>';
    showModal('<div class="mhead"><div class="mtitle">' + esc(ev.emoji || "🎯") + ' <span data-noi18n>' + esc(ev.title) + '</span></div>' +
        '<button class="ib" type="button" onclick="closeModal()" aria-label="ปิด" style="font-size:19px;">✕</button></div>' +
      '<div class="hint" style="margin-top:-6px;">' + whenHtml(ev) + '</div>' +
      (ev.note ? '<div class="hint" data-noi18n style="margin-top:4px;">' + esc(ev.note) + '</div>' : '') +
      '<div class="ev-big" data-evcd="' + esc(ev.id) + '">' + bigHtml(ev, now) + '</div>' +
      (isPast(ev) ? '' : '<div class="ev-tiles" data-evtiles="' + esc(ev.id) + '">' + tilesHtml(ev, now) + '</div><div class="ev-bar"><i style="width:' + progress(ev, now) + '%"></i></div>') +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin:18px 0 4px;">' +
        '<div style="font-weight:700;">' + T("นักเรียนที่เข้าร่วม", "Students taking part") + ' (' + c.length + ')</div>' +
        '<button class="btn-brass" type="button" data-ev-pick style="min-height:40px;padding:6px 14px;">✓ ' + T("เลือกนักเรียน", "Choose students") + '</button></div>' +
      (c.length && !isPast(ev) ? '<div class="hint" style="margin-bottom:4px;">' + T("นับจากคาบที่ลงไว้ + ตารางประจำสัปดาห์ (ข้ามวันหยุด) · เรียงจากคนที่เหลือน้อยสุด", "Counted from booked lessons + weekly schedule (skipping days off) · fewest first") + '</div>' : '') +
      '<div>' + rows + '</div>' +
      '<div class="modal-foot" style="margin-top:16px;">' +
        '<button class="btn-g" type="button" data-ev-del style="flex:1;color:#B91C1C;">' + T("ลบงาน", "Delete") + '</button>' +
        '<button class="btn-g" type="button" data-ev-edit style="flex:2;">✎ ' + T("แก้ไขงาน", "Edit event") + '</button></div>', "560px");
  }
  window.openEvent = openEvent;

  function withdraw(id, key) {
    var ev = byId(id); if (!ev) return;
    var i = ev.students.indexOf(key); if (i < 0) return;
    ev.students.splice(i, 1); ev.updatedAt = nowISO(); persist();
    toast(T("ถอน " + displayName(key) + " ออกจากงานแล้ว", "Removed " + displayName(key)), { label: T("เลิกทำ", "Undo"), fn: function () {
      var e2 = byId(id); if (e2 && e2.students.indexOf(key) < 0) { e2.students.splice(Math.min(i, e2.students.length), 0, key); e2.updatedAt = nowISO(); persist(); }
      if (document.getElementById("modal-box") && CUR === id) openEvent(id); else if (typeof renderAll === "function") renderAll();
    } });
  }

  /* ── เลือกนักเรียน (ติ๊กเร็ว) ── */
  var PK = { q: "", f: "all" };
  function studentTags(key) {
    var tags = {}, cut = addDays(todayStr(), -120);
    (S.schedule || []).forEach(function (e) { if (e.student === key) tags[e.kind === "private" ? "private" : "p" + e.placeId] = 1; });
    S.lessons.forEach(function (l) { if (l.student === key && l.date >= cut) tags[l.kind === "private" ? "private" : "p" + l.placeId] = 1; });
    if ((S.schedule || []).some(function (e) { return e.student === key; })) tags.sched = 1;
    return tags;
  }
  function pickList(ev) {
    var keys = (S.students || []).map(function (r) { return r.key; });
    if (typeof getStudents === "function") getStudents().forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
    ev.students.forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
    var q = PK.q.trim().toLowerCase();
    return keys.filter(function (k) {
      var nm = displayName(k);
      if (q && String(nm).toLowerCase().indexOf(q) < 0 && String(k).toLowerCase().indexOf(q) < 0) return false;
      if (PK.f === "all") return true;
      if (PK.f === "on") return ev.students.indexOf(k) >= 0;
      return !!studentTags(k)[PK.f];
    }).sort(function (a, b) { return displayName(a).localeCompare(displayName(b), "th"); });
  }
  function openPicker(id) {
    var ev = byId(id); if (!ev) return;
    CUR = ev.id;
    var places = (typeof getPlaces === "function" ? getPlaces(false) : []);
    var chips = [["all", T("ทุกคน", "Everyone")], ["on", T("ที่เลือกแล้ว", "Chosen")], ["sched", T("มีตารางประจำ", "Has a schedule")]]
      .concat(places.map(function (p) { return ["p" + p.id, p.name]; })).concat([["private", T("ส่วนตัว", "Private")]]);
    showModal('<div class="mhead"><div class="mtitle">✓ ' + T("เลือกนักเรียน", "Choose students") + '</div>' +
        '<button class="ib" type="button" data-ev-back aria-label="ปิด" style="font-size:19px;">✕</button></div>' +
      '<div class="hint" style="margin-top:-6px;"><span data-noi18n>' + esc(ev.title) + '</span> · ' + T("แตะชื่อเพื่อติ๊ก/เอาออก บันทึกทันที", "Tap a name to add/remove — saved instantly") + '</div>' +
      '<input id="ev-q" type="search" placeholder="' + T("ค้นชื่อ", "Search name") + '" value="' + esc(PK.q) + '" style="margin-top:10px;">' +
      '<div class="ev-chips">' + chips.map(function (c) { return '<button type="button" data-ev-f="' + esc(c[0]) + '" class="' + (PK.f === c[0] ? 'on' : '') + '"' + (c[0].charAt(0) === "p" && c[0] !== "private" ? ' data-noi18n' : '') + '>' + esc(c[1]) + '</button>'; }).join("") + '</div>' +
      '<div style="display:flex;gap:8px;margin-bottom:6px;"><button class="btn-g" type="button" data-ev-all="1" style="flex:1;min-height:38px;">' + T("เลือกทั้งหมดที่เห็น", "Select all shown") + '</button>' +
        '<button class="btn-g" type="button" data-ev-all="0" style="flex:1;min-height:38px;">' + T("เอาออกทั้งหมดที่เห็น", "Clear all shown") + '</button></div>' +
      '<div id="ev-picklist" style="max-height:52vh;overflow-y:auto;border-top:2px solid #000;"></div>' +
      '<div class="modal-foot" style="margin-top:12px;"><button class="btn-p" type="button" data-ev-back style="flex:1;" id="ev-done"></button></div>', "520px");
    fillPicker(ev);
    var qi = document.getElementById("ev-q");
    if (qi) qi.addEventListener("input", function () { PK.q = qi.value; fillPicker(byId(id)); });
  }
  function fillPicker(ev) {
    var host = document.getElementById("ev-picklist"); if (!host || !ev) return;
    var ks = pickList(ev);
    host.innerHTML = ks.length ? ks.map(function (k) {
      var on = ev.students.indexOf(k) >= 0;
      return '<label class="ev-pick' + (on ? ' on' : '') + '"><input type="checkbox" data-ev-tick="' + esc(k) + '"' + (on ? ' checked' : '') + '>' +
        avatarHtml(displayName(k), S.photos[k], 34) + '<span data-noi18n style="flex:1;min-width:0;font-weight:600;">' + esc(displayName(k)) + '</span></label>';
    }).join("") : '<div class="empty" style="padding:20px;">' + T("ไม่พบนักเรียน", "No students found") + '</div>';
    var d = document.getElementById("ev-done");
    if (d) d.textContent = T("เสร็จ · เลือกแล้ว " + ev.students.length + " คน", "Done · " + ev.students.length + " chosen");
  }
  function tick(id, key, on) {
    var ev = byId(id); if (!ev) return;
    var i = ev.students.indexOf(key);
    if (on && i < 0) ev.students.push(key);
    if (!on && i >= 0) ev.students.splice(i, 1);
    ev.updatedAt = nowISO();
    persist();
  }

  /* ── สร้าง/แก้งาน ── */
  var EVF = null;
  function openForm(id) {
    var ev = id != null ? byId(id) : null;
    EVF = ev ? JSON.parse(JSON.stringify(ev)) : { id: newId(), title: "", date: addDays(todayStr(), 30), time: "", place: "", note: "", emoji: "🎤", students: [], createdAt: nowISO() };
    EVF._new = !ev;
    showModal('<div class="mhead"><div class="mtitle">' + (ev ? T("แก้ไขงานสำคัญ", "Edit key event") : T("เพิ่มงานสำคัญ", "New key event")) + '</div>' +
        '<button class="ib" type="button" data-ev-cancel aria-label="ปิด" style="font-size:19px;">✕</button></div>' +
      '<div style="display:flex;flex-direction:column;gap:14px;">' +
        '<div><label>' + T("ชื่องาน *", "Event name *") + '</label><input id="evf-title" value="' + esc(EVF.title) + '" placeholder="' + T("เช่น คอนเสิร์ตปลายปี, สอบเกรด 3", "e.g. Year-end concert, Grade 3 exam") + '"></div>' +
        '<div class="ev-emos">' + EMOJI.map(function (e) { return '<button type="button" data-evf-emo="' + e + '" class="' + (EVF.emoji === e ? 'on' : '') + '">' + e + '</button>'; }).join("") + '</div>' +
        '<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:11px;">' +
          '<div><label>' + T("วันที่ *", "Date *") + '</label><input id="evf-date" type="date" value="' + esc(EVF.date) + '"></div>' +
          '<div><label>' + T("เวลา (ไม่บังคับ)", "Time (optional)") + '</label><input id="evf-time" type="time" value="' + esc(EVF.time || "") + '"></div></div>' +
        '<div><label>' + T("สถานที่ (ไม่บังคับ)", "Place (optional)") + '</label><input id="evf-place" value="' + esc(EVF.place || "") + '" placeholder="' + T("เช่น หอประชุมโรงเรียน", "e.g. School hall") + '"></div>' +
        '<div><label>' + T("หมายเหตุ (ไม่บังคับ)", "Note (optional)") + '</label><input id="evf-note" value="' + esc(EVF.note || "") + '" placeholder="' + T("เช่น เพลงที่เล่น ชุดที่ใส่", "e.g. songs, outfit") + '"></div>' +
        '<div class="hint">' + T("ใส่เวลาแล้ว คาบในวันงานที่อยู่ก่อนเวลางานจะนับรวมด้วย · 2 วันสุดท้ายนับเป็นวินาที", "With a time, lessons earlier on the event day count too · the last 2 days count down by the second") + '</div>' +
      '</div>' +
      '<div class="modal-foot" style="margin-top:16px;"><button class="btn-g" type="button" data-ev-cancel style="flex:1;">' + T("ยกเลิก", "Cancel") + '</button>' +
        '<button class="btn-p" type="button" data-evf-save style="flex:2;">' + (ev ? T("บันทึก", "Save") : T("สร้างแล้วเลือกนักเรียน", "Create & choose students")) + '</button></div>', "480px");
  }
  window.openEventForm = openForm;
  function saveForm() {
    var g = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ""; };
    EVF.title = g("evf-title"); EVF.date = g("evf-date"); EVF.time = g("evf-time"); EVF.place = g("evf-place"); EVF.note = g("evf-note");
    if (!EVF.title) { toast(T("ใส่ชื่องานก่อน", "Enter a name first")); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(EVF.date)) { toast(T("เลือกวันที่ของงาน", "Pick the event date")); return; }
    var isNew = EVF._new; delete EVF._new;
    EVF.updatedAt = nowISO();
    var arr = list(), i = arr.findIndex(function (e) { return String(e.id) === String(EVF.id); });
    if (i >= 0) arr[i] = EVF; else arr.push(EVF);
    persist();
    var id = EVF.id; EVF = null;
    if (isNew) openPicker(id); else openEvent(id);
  }
  function delEvent(id) {
    var ev = byId(id); if (!ev) return;
    if (!confirm(T("ลบงาน “" + ev.title + "” ?", "Delete “" + ev.title + "”?"))) return;
    var arr = list(), i = arr.indexOf(ev);
    arr.splice(i, 1); persist(); closeModal();
    toast(T("ลบงานแล้ว", "Event deleted"), { label: T("เลิกทำ", "Undo"), fn: function () { list().splice(i, 0, ev); persist(); renderAll(); } });
  }

  /* ── รายการทั้งหมด (จากหน้าตั้งค่า) ── */
  function openEvents() {
    showModal('<div class="mhead"><div class="mtitle">🎯 ' + T("งานสำคัญ", "Key events") + '</div>' +
      '<button class="ib" type="button" onclick="closeModal()" aria-label="ปิด" style="font-size:19px;">✕</button></div>' +
      '<div class="hint" style="margin:-6px 0 12px;">' + T("นับถอยหลังถึงวันงาน และดูว่านักเรียนแต่ละคนเรียนอีกกี่ครั้ง", "Count down to the day and see how many lessons each student has left") + '</div>' +
      sectionHtml().replace(/^<div class="ovsec" id="ev-sec"><h3>[^<]*<\/h3>/, '<div id="ev-list">'), "560px");
  }
  window.openEvents = openEvents;

  /* ── คลิกทั้งหมดของชั้นนี้ ── */
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target : null; if (!t) return;
    var el;
    if ((el = t.closest("[data-ev-open]"))) { e.preventDefault(); openEvent(el.getAttribute("data-ev-open")); return; }
    if ((el = t.closest("[data-ev-new]"))) { e.preventDefault(); openForm(null); return; }
    if ((el = t.closest("[data-ev-out]"))) { e.preventDefault(); withdraw(CUR, el.getAttribute("data-ev-out")); openEvent(CUR); return; }
    if ((el = t.closest("[data-ev-pick]"))) { PK = { q: "", f: "all" }; openPicker(CUR); return; }
    if ((el = t.closest("[data-ev-edit]"))) { openForm(CUR); return; }
    if ((el = t.closest("[data-ev-del]"))) { delEvent(CUR); return; }
    if ((el = t.closest("[data-ev-back]"))) { openEvent(CUR); return; }
    if ((el = t.closest("[data-ev-cancel]"))) { if (EVF && !EVF._new) openEvent(EVF.id); else closeModal(); EVF = null; return; }
    if ((el = t.closest("[data-evf-save]"))) { saveForm(); return; }
    if ((el = t.closest("[data-evf-emo]"))) {
      EVF.emoji = el.getAttribute("data-evf-emo");
      Array.prototype.forEach.call(document.querySelectorAll("[data-evf-emo]"), function (b) { b.classList.toggle("on", b === el); });
      return;
    }
    if ((el = t.closest("[data-ev-f]"))) {
      PK.f = el.getAttribute("data-ev-f");
      Array.prototype.forEach.call(document.querySelectorAll("[data-ev-f]"), function (b) { b.classList.toggle("on", b === el); });
      fillPicker(byId(CUR)); return;
    }
    if ((el = t.closest("[data-ev-all]"))) {
      var ev = byId(CUR); if (!ev) return;
      var on = el.getAttribute("data-ev-all") === "1";
      pickList(ev).forEach(function (k) { var i = ev.students.indexOf(k); if (on && i < 0) ev.students.push(k); if (!on && i >= 0) ev.students.splice(i, 1); });
      ev.updatedAt = nowISO(); persist(); fillPicker(ev); return;
    }
  }, true);
  document.addEventListener("change", function (e) {
    var el = e.target;
    if (el && el.hasAttribute && el.hasAttribute("data-ev-tick")) {
      tick(CUR, el.getAttribute("data-ev-tick"), el.checked);
      var row = el.closest(".ev-pick"); if (row) row.classList.toggle("on", el.checked);
      var ev = byId(CUR), d = document.getElementById("ev-done");
      if (ev && d) d.textContent = T("เสร็จ · เลือกแล้ว " + ev.students.length + " คน", "Done · " + ev.students.length + " chosen");
    }
    if (el && el.hasAttribute && el.hasAttribute("data-ev-join")) {
      var p = el.getAttribute("data-ev-join").split("|");
      tick(p[0], p.slice(1).join("|"), el.checked);
      if (typeof showStudentModal === "function") showStudentModal();
    }
  }, true);

  /* ── หน้านักเรียน: งานที่น้องเข้าร่วม ── */
  if (typeof window.showStudentModal === "function") {
    var origStu = window.showStudentModal;
    window.showStudentModal = function () {
      var r = origStu.apply(this, arguments);
      var key = window.HIST && HIST.student, box = document.getElementById("modal-box");
      var up = sorted().up;
      if (!key || !box || !up.length || box.querySelector(".ev-stu")) return r;
      var html = up.map(function (ev) {
        var on = ev.students.indexOf(key) >= 0;
        var c = on ? counts({ id: ev.id, date: ev.date, time: ev.time, students: [key] })[0] : null;
        return '<label class="ev-pick' + (on ? ' on' : '') + '" style="border:2px solid #000;border-radius:3px;margin-bottom:6px;">' +
          '<input type="checkbox" data-ev-join="' + esc(ev.id + "|" + key) + '"' + (on ? ' checked' : '') + '>' +
          '<span style="font-size:20px;">' + esc(ev.emoji || "🎯") + '</span><span style="flex:1;min-width:0;"><span data-noi18n style="font-weight:700;">' + esc(ev.title) + '</span>' +
          '<span class="hint" style="display:block;">' + esc(shortText(ev, new Date())) + (c ? " · " + esc(countText(c)) : " · " + T("ยังไม่เข้าร่วม", "not taking part")) + '</span></span></label>';
      }).join("");
      var div = document.createElement("div"); div.className = "ev-stu"; div.style.margin = "0 0 14px";
      div.innerHTML = '<div style="font-weight:700;margin-bottom:6px;">🎯 ' + T("งานสำคัญ", "Key events") + '</div>' + html;
      var head = box.querySelector(".mhead") || box.firstElementChild;
      if (head && head.nextSibling) box.insertBefore(div, head.nextSibling); else box.appendChild(div);
      return r;
    };
  }

  /* ── แถวในหน้าตั้งค่า (หมวด "การสอน") ── */
  if (typeof window.openMenu === "function") {
    var origMenu = window.openMenu;
    window.openMenu = function () {
      var r = origMenu.apply(this, arguments);
      var anchor = document.querySelector('#modal-root button.srow[onclick*="openPasteImport"]') || document.querySelector('#modal-root button.srow');
      if (anchor && !document.getElementById("ev-row")) {
        var b = document.createElement("button");
        b.className = "srow"; b.type = "button"; b.id = "ev-row"; b.style.marginBottom = "8px";
        var n = sorted().up.length;
        b.innerHTML = '<span style="font-size:18px;flex-shrink:0;">🎯</span><div style="min-width:0;"><div style="font-weight:600;">งานสำคัญ (นับถอยหลัง)</div>' +
          '<div style="font-size:11px;color:#5A5A5A;margin-top:2px;">' + (n ? T("มี " + n + " งานข้างหน้า", n + (n === 1 ? " upcoming event" : " upcoming events")) : T("คอนเสิร์ต สอบ แข่งขัน — นับวันและคาบที่เหลือ", "Concerts, exams, contests — days and lessons left")) + '</div></div>';
        b.addEventListener("click", function () { openEvents(); });
        anchor.parentNode.insertBefore(b, anchor.nextSibling);
      }
      return r;
    };
  }
  window.__events = "on";
})();
