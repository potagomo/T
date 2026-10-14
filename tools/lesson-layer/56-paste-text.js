/* ชั้นเว็บแอป: วางตารางจากข้อความของแอปไหนก็ได้ — tools/update-lesson.py ฝังไฟล์นี้ไว้ท้าย lesson/index.html

   ตัวอ่านตารางของแอปเขียนมาสำหรับข้อความที่คัดลอกจาก LINE ตรง ๆ ข้อความจากแอปอื่นมีของแถมที่ทำให้อ่านผิด:
     • WhatsApp: "[14/10/2569 09:15] แอดมินโบว์: …" / "14/10/69 09:15 - แอดมินโบว์: …" → เวลาส่งถูกอ่านเป็นเวลาเรียน ชื่อคนส่งเป็นนักเรียน
     • LINE แบบบันทึกแชท (.txt): "09:15⇥แอดมินโบว์⇥"ข้อความ"" และบรรทัดวันที่ของแชท
     • Telegram: "แอดมินโบว์, [14.10.2026 09:15]" · Messenger/อื่น ๆ: "ส่งเมื่อ 09:15" "อ่านแล้ว"
     • ตัวเลข/โคลอนเต็มความกว้าง (１６：００) · เลขข้อ "1) 16.00 ภีม" · สัญลักษณ์หัวข้อ ▪ ◦ ➤ ☐ 📌 · ตารางจาก Google Sheets/Excel (แท็บ)
     • ขึ้นบรรทัดแบบ \r หรือ U+2028 (คัดลอกจาก iOS/แอปเก่า)
   ชั้นนี้ทำความสะอาดก่อนส่งให้ตัวอ่านเดิม ทีละบรรทัด (จำนวนบรรทัดเท่าเดิม "ที่มา: บรรทัด N" ยังชี้ถูก)
   และเปลี่ยนชื่อปุ่ม/หัวข้อ "วางตารางจากไลน์" → "วางตารางจากข้อความ" */
(function () {
  "use strict";
  if (typeof window.parseSchedule !== "function") { window.__pasteText = "missing"; return; }

  var TIME = "\\d{1,2}[:.]\\d{2}(?:[:.]\\d{2})?(?:\\s?[AaPp]\\.?\\s?[Mm]\\.?)?";
  var DATE = "\\d{1,4}[\\/.\\-]\\d{1,2}[\\/.\\-]\\d{1,4}";
  // WhatsApp: [วันที่, เวลา] ชื่อ: ข้อความ  หรือ  วันที่ เวลา - ชื่อ: ข้อความ
  var WA = new RegExp("^\\[?" + DATE + ",?\\s+" + TIME + "\\]?\\s*(?:-\\s*)?([^:\\[\\]]{1,40}):\\s?");
  var WA_SYS = new RegExp("^\\[?" + DATE + ",?\\s+" + TIME + "\\]?\\s*-\\s*[^:]*$");          // ข้อความระบบ (ไม่มีผู้ส่ง)
  var TG_HEAD = new RegExp("^[^\\[\\]\\n]{1,40},\\s*\\[" + DATE + "\\s+" + TIME + "\\]\\s*$");    // Telegram: ชื่อ, [วันที่ เวลา]
  var TG_INLINE = new RegExp("^\\[" + DATE + "\\s+" + TIME + "\\]\\s*([^:]{1,40}):\\s?");        // [วันที่ เวลา] ชื่อ: …
  var LINE_ROW = /^\d{1,2}:\d{2}\t[^\t]*\t/;                                                       // LINE บันทึกแชท: เวลา⇥ชื่อ⇥ข้อความ
  var LINE_DAY = /^(?:\d{4}[.\/-]\d{1,2}[.\/-]\d{1,2}\s*(?:\(?[A-Za-z฀-๿.]+\)?)?|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,\s*\d{1,2}\/\d{1,2}\/\d{2,4}|[฀-๿.]+,\s*\d{1,2}\/\d{1,2}\/\d{2,4})\s*$/;
  var LINE_META = /^(?:\[LINE\]|ประวัติการแชท|บันทึกเมื่อ\s*:|Saved on\s*:|Chat history)/i;
  // บรรทัดสถานะของแอปแชท (ทั้งบรรทัดเป็นแค่สถานะ + เวลา) เช่น "ส่งเมื่อ 09:15" "อ่านแล้ว" "Seen 9:15 PM"
  var STATUS = new RegExp("^(?:ส่งเมื่อ|ส่งแล้ว|อ่านแล้ว|เห็นแล้ว|แก้ไขแล้ว|Sent|Seen|Read|Delivered|Edited)(?:\\s*(?:เมื่อ|at|·)?\\s*" + TIME + "(?:\\s?น\\.)?)?\\s*$", "i");
  // หัวข้อ/เลขข้อหน้าบรรทัด: สัญลักษณ์ใด ๆ ที่ไม่ใช่ตัวอักษร/ตัวเลข/วงเล็บ/# · "1)" "2." "(3)" ที่ตามด้วยช่องว่าง
  var LEAD = /^[^\p{L}\p{N}\[(#"'“]+/u, NUMBERED = /^\(?[0-9๐-๙]{1,2}[).]\s+/;

  function chars(s) {
    return s
      .replace(/[\uFF01-\uFF5E]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })   // １６：００ → 16:00
      .replace(/[\u3000\u2000-\u200A\u202F\u205F]/g, " ")
      .replace(/[\u200E\u200F\u2060\u202A-\u202E\uFE0E]/g, "");
  }
  // ทั้งข้อความ: ขึ้นบรรทัดทุกแบบเป็น \n (ทำกับข้อความในช่องด้วย เลขบรรทัดจะได้ตรงกัน)
  function lines(t) { return String(t == null ? "" : t).replace(/\r\n/g, "\n").replace(/[\r\u2028\u2029\u0085]/g, "\n"); }

  function clean(text) {
    var L = lines(text).split("\n");
    // ไฟล์บันทึกแชท LINE: มีแถว เวลา⇥ชื่อ⇥ข้อความ และมีหัวไฟล์/บรรทัดวันที่ของแชท (ตารางจาก Sheets ก็มีแท็บ แต่ไม่มีสองอย่างหลัง)
    var lineExport = L.some(function (x) { return LINE_ROW.test(x); }) && L.some(function (x) { var t = chars(x).trim(); return LINE_META.test(t) || LINE_DAY.test(t); });
    var wa = L.some(function (x) { return WA.test(chars(x)); });                 // มีหัวข้อความแบบ WhatsApp อย่างน้อยหนึ่งบรรทัด
    return L.map(function (raw) {
      var s = chars(raw);
      if (lineExport) {
        if (LINE_META.test(s.trim()) || LINE_DAY.test(s.trim())) return "";
        s = s.replace(LINE_ROW, "").replace(/^"+/, "").replace(/"+\s*$/, "");
      }
      if (TG_HEAD.test(s.trim()) || wa && WA_SYS.test(s.trim()) && !WA.test(s)) return "";
      s = s.replace(WA, "").replace(TG_INLINE, "");
      if (STATUS.test(s.trim())) return "";
      s = s.replace(/\t+/g, "  ");                                             // ตาราง (Sheets/Excel): แท็บ → ช่องว่าง
      var t = s.replace(LEAD, "");
      if (t !== s) s = t;
      s = s.replace(NUMBERED, "");
      return s;
    }).join("\n");
  }
  window.__cleanPaste = clean;

  var origParse = window.parseSchedule;
  window.parseSchedule = function (text) {
    var a = Array.prototype.slice.call(arguments);
    a[0] = clean(text);
    return origParse.apply(this, a);
  };
  // ข้อความในช่อง: ขึ้นบรรทัดแบบเดียวกับที่อ่าน ("ที่มา: บรรทัด N" ชี้บรรทัดเดียวกัน)
  if (typeof window.reparseImport === "function") {
    var origRe = window.reparseImport;
    window.reparseImport = function () {
      if (window.PI && typeof PI.text === "string" && /[\r\u2028\u2029\u0085]/.test(PI.text)) PI.text = lines(PI.text);
      return origRe.apply(this, arguments);
    };
  }

  /* ── ชื่อปุ่ม/หัวข้อ: ไม่ผูกกับ LINE แล้ว ── */
  var LABELS = [
    ["วางตารางจากไลน์ของโรงเรียน", "วางตารางจากข้อความ"],
    ["ตอนวางตารางจากไลน์", "ตอนวางตาราง"],
    ["วางตารางจากไลน์", "วางตารางจากข้อความ"],
    ["คัดลอกข้อความตารางจากแชทโรงเรียนแล้ววางด้านล่าง", "คัดลอกข้อความตารางจากแอปไหนก็ได้ (LINE · WhatsApp · Messenger · Telegram · อีเมล · โน้ต · Google Sheets) แล้ววางด้านล่าง"]
  ];
  function swap(s) { for (var i = 0; i < LABELS.length; i++) if (s.indexOf(LABELS[i][0]) >= 0) s = s.split(LABELS[i][0]).join(LABELS[i][1]); return s; }
  var HIT = /วางตารางจากไลน์|แชทโรงเรียนแล้ววาง/;
  function relabel(root) {
    if (!root || !HIT.test(root.textContent || "") && !root.querySelector("[placeholder*='ไลน์']")) return;
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), n;
    while ((n = tw.nextNode())) if (HIT.test(n.nodeValue)) { var v = swap(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; }
    Array.prototype.forEach.call(root.querySelectorAll("[placeholder*='ไลน์']"), function (el) { el.setAttribute("placeholder", swap(el.getAttribute("placeholder"))); });
  }
  window.__relabelPaste = relabel;
  if (typeof window.showModal === "function") {
    var origModal = window.showModal;
    window.showModal = function () { var r = origModal.apply(this, arguments); relabel(document.getElementById("modal-box")); return r; };
  }
  if (typeof window.renderAll === "function") {
    var origRender = window.renderAll;
    window.renderAll = function () { var r = origRender.apply(this, arguments); relabel(document.getElementById("view-" + (window.S && S.tab))); return r; };
  }
  window.__pasteText = "on";
})();
