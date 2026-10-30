/* ชั้นเว็บแอป: เลื่อน / ซูมรูปปกในรูปส่งผู้ปกครอง — tools/update-lesson.py ฝังไฟล์นี้ไว้ท้าย lesson/index.html

   กรอบรูปของคาบในการ์ดเป็นแนวนอน (สูงไม่เกิน 420) แอปตัดรูปตรงกลางเสมอ รูปแนวตั้ง (น้องนั่งตีกลอง) จึงเห็นแค่ลำตัว คอขาด
   ชั้นนี้:
     • แตะรูปในตัวอย่าง (หรือปุ่ม ✥ เลื่อน / ซูมรูปปก) → ลากรูปให้เห็นหน้า ซูมด้วยแถบหรือสองนิ้ว → ใช้ตำแหน่งนี้
     • จำรายคาบที่ l.media.crop = { x, y, z } (x, y = 0 ชิดซ้าย/บน · 1 ชิดขวา/ล่าง · z = ซูม 1–4) ซิงค์ไปกับคาบ
       เปลี่ยนรูป/คลิปของคาบ = ตำแหน่งเริ่มใหม่ (ค่าอยู่กับ l.media)
     • คาบที่ยังไม่ได้ตั้ง และยังไม่เคยส่งการ์ด: ตัดค่อนไปทางบน (y = TOP) ให้เห็นหน้าก่อน
       การ์ดที่ส่งไปแล้วคงตัดตรงกลางแบบเดิม (รหัสตรวจ "ตรงกับรูปที่ส่งไป" ไม่เพี้ยน)
   วิธีวาด: ตัดรูปเป็นสัดส่วนเดียวกับกรอบก่อนส่งให้ layoutCard เดิม (กรอบ/ขอบ/เงาของทุกหน้าตาเหมือนเดิม) */
(function () {
  "use strict";
  var NEED = ["layoutCard", "renderCardCanvas", "canvasToBlob", "rcShow", "rcActionsHtml", "rcRender", "rcLesson"];
  var miss = NEED.filter(function (n) { return typeof window[n] !== "function"; });
  if (miss.length) { window.__coverCrop = "missing: " + miss.join(","); return; }

  var TOP = 0.25, ZMAX = 4;
  function clamp(v, a, b) { v = +v; return isFinite(v) ? Math.min(b, Math.max(a, v)) : a; }
  function cropOf(l) {
    var c = l && l.media && l.media.crop, y0 = l && l.sentCard ? 0.5 : TOP;
    return c ? { x: clamp(c.x == null ? 0.5 : c.x, 0, 1), y: clamp(c.y == null ? y0 : c.y, 0, 1), z: clamp(c.z || 1, 1, ZMAX) }
             : { x: 0.5, y: y0, z: 1 };
  }
  function plain(c) { return c.x === 0.5 && c.y === 0.5 && c.z === 1; }
  window.__coverCropOf = cropOf;

  // กรอบรูปของ layoutCard (สูตรเดียวกับต้นฉบับ: PAD = 40 × ระยะห่าง · ขอบใน 9 · สูงไม่เกิน 420)
  function frame(W, ST, img) {
    var PAD = Math.round(40 * num(ST.spacing, 1)), iw = W - PAD * 2 - 18;
    return { x: PAD + 9, iw: iw, ih: Math.min(420, Math.round(iw * img.height / img.width)) };
  }
  // ส่วนของรูปต้นฉบับที่เห็นในกรอบ iw × ih
  function region(img, iw, ih, c) {
    var s = Math.max(iw / img.width, ih / img.height) * c.z, sw = iw / s, sh = ih / s;
    return { sx: (img.width - sw) * c.x, sy: (img.height - sh) * c.y, sw: sw, sh: sh };
  }
  var MEMO = typeof WeakMap === "function" ? new WeakMap() : null;
  function cropped(img, iw, ih, c) {
    var key = iw + "|" + ih + "|" + c.x + "|" + c.y + "|" + c.z, m = MEMO && MEMO.get(img);
    if (m && m.key === key) return m.cv;
    var r = region(img, iw, ih, c), k = Math.min(1, 2400 / r.sw);
    var cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(r.sw * k)); cv.height = Math.max(1, Math.round(r.sh * k));
    cv.getContext("2d").drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, cv.width, cv.height);
    if (MEMO) MEMO.set(img, { key: key, cv: cv });
    return cv;
  }

  /* ── วาด: แทนรูปด้วยส่วนที่ตัดแล้ว + จดตำแหน่งกรอบในการ์ด (ไว้วางจุดแตะบนตัวอย่าง) ── */
  var LASTSRC = null, RECT = null;
  var origLayout = window.layoutCard;
  window.layoutCard = function (ctx, W, l, imgs, draw, textScale, ST) {
    var st = ST || withDefaults(baseStyle()), src = imgs && imgs.media;
    if (!src || !src.width || !src.height || !(st.sections || {}).media) return origLayout.apply(this, arguments);
    LASTSRC = { id: l && l.id, img: src };
    var f = frame(W, st, src), c = cropOf(l), use = plain(c) ? src : cropped(src, f.iw, f.ih, c);
    var a = Array.prototype.slice.call(arguments);
    if (use !== src) a[3] = Object.assign({}, imgs, { media: use });
    if (!draw || !ctx) return origLayout.apply(this, a);
    var rect = null, ih = Math.min(420, Math.round(f.iw * use.height / use.width));
    ctx.drawImage = function (im, dx, dy, dw, dh) {
      if (im === use && arguments.length === 5 && !rect) rect = { x: f.x, y: dy - (ih - dh) / 2, w: f.iw, h: ih };
      return CanvasRenderingContext2D.prototype.drawImage.apply(this, arguments);
    };
    var H;
    try { H = origLayout.apply(this, a); } finally { delete ctx.drawImage; }
    if (rect) { rect.W = W; rect.H = Math.ceil(H); rect.id = l && l.id; RECT = rect; }
    return H;
  };
  var origCanvas = window.renderCardCanvas;
  window.renderCardCanvas = function () {
    RECT = null;
    var cv = origCanvas.apply(this, arguments);
    if (cv && RECT) cv.__mediaRect = RECT;
    RECT = null;
    return cv;
  };
  var origBlob = window.canvasToBlob;
  window.canvasToBlob = function (canvas) {
    return origBlob.apply(this, arguments).then(function (b) {
      if (b && canvas && canvas.__mediaRect) try { b.__mediaRect = canvas.__mediaRect; } catch (e) {}
      return b;
    });
  };

  function rectNow() {
    var l = rcLesson(), r = window.RC && RC.blob && RC.blob.__mediaRect;
    return l && r && r.id === l.id ? r : null;
  }

  /* ── ตัวอย่าง: แตะที่รูปในการ์ดเพื่อเลื่อน ── */
  var origShow = window.rcShow;
  window.rcShow = function () {
    var res = origShow.apply(this, arguments);
    var host = document.getElementById("rc-preview"), r = rectNow();
    if (host && r) {
      host.style.position = "relative";
      var b = document.createElement("button");
      b.type = "button"; b.id = "cc-hit"; b.setAttribute("aria-label", "เลื่อน / ซูมรูปปก");
      b.style.cssText = "position:absolute;left:" + (100 * r.x / r.W) + "%;top:" + (100 * r.y / r.H) + "%;width:" + (100 * r.w / r.W) + "%;height:" + (100 * r.h / r.H) +
        "%;background:transparent;border:0;padding:0;margin:0;cursor:move;display:flex;align-items:flex-end;justify-content:flex-end;";
      b.innerHTML = '<span style="margin:8px;padding:5px 10px;border-radius:999px;background:rgba(0,0,0,0.62);color:#FFFFFF;font-size:12.5px;font-weight:700;pointer-events:none;">✥ แตะเพื่อเลื่อนรูป</span>';
      b.addEventListener("click", openCrop);
      host.appendChild(b);
    }
    return res;
  };
  var origActions = window.rcActionsHtml;
  window.rcActionsHtml = function () {
    var res = origActions.apply(this, arguments);
    var box = document.getElementById("rc-actions"), col = box && box.firstElementChild;
    if (col && rectNow() && !document.getElementById("cc-btn")) {
      var b = document.createElement("button");
      b.type = "button"; b.id = "cc-btn"; b.className = "btn-g"; b.style.width = "100%";
      b.textContent = "✥ เลื่อน / ซูมรูปปก";
      b.addEventListener("click", openCrop);
      col.appendChild(b);                                      // ปุ่มแชร์ยังเป็นปุ่มแรก · ทางหลักคือแตะรูปในตัวอย่าง
    }
    return res;
  };

  /* ── หน้าปรับตำแหน่ง ── */
  function sourceOf(l) {
    if (LASTSRC && LASTSRC.id === l.id && LASTSRC.img) return Promise.resolve(LASTSRC.img);
    return MDB.get(mediaKey(l.id)).then(function (full) { return loadImage(full || THUMB[l.id] || null); });
  }
  function openCrop() {
    var l = rcLesson(), r = rectNow();
    if (!l || !l.media || !r) return;
    sourceOf(l).then(function (img) {
      if (!img || !img.width) { toast("ไม่พบรูปของคาบนี้ในเครื่อง"); return; }
      editor(l, img, r.w, r.h);
    });
  }
  function editor(l, img, iw, ih) {
    var c = cropOf(l), first = JSON.stringify(c);
    var box = document.createElement("div");
    box.id = "cc-sheet"; box.className = "overlay";
    box.style.cssText = "z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,0.55);";
    box.innerHTML = '<div class="modal-box" style="max-width:520px;width:100%;">' +
      '<div style="font-weight:700;font-size:16px;margin-bottom:4px;">✥ เลื่อน / ซูมรูปปก</div>' +
      '<div class="hint" style="margin-bottom:10px;">ลากรูปให้เห็นหน้าน้อง · ซูมด้วยแถบด้านล่าง หรือถ่างสองนิ้ว</div>' +
      '<div id="cc-frame" style="position:relative;width:100%;aspect-ratio:' + iw + ' / ' + ih + ';border:2px solid #000000;border-radius:3px;overflow:hidden;touch-action:none;cursor:grab;background:#000000;">' +
        '<canvas id="cc-cv" style="width:100%;height:100%;display:block;"></canvas></div>' +
      '<label style="display:flex;align-items:center;gap:10px;margin:12px 0 4px;font-size:14px;">🔍 ซูม' +
        '<input id="cc-zoom" type="range" min="100" max="' + (ZMAX * 100) + '" step="5" style="flex:1;min-width:0;"><span id="cc-zv" class="hint" style="min-width:44px;text-align:right;"></span></label>' +
      '<div style="display:flex;gap:8px;margin:10px 0 8px;">' +
        '<button class="btn-g" type="button" id="cc-up" style="flex:1;">⤒ บน</button>' +
        '<button class="btn-g" type="button" id="cc-mid" style="flex:1;">◎ กลาง</button>' +
        '<button class="btn-g" type="button" id="cc-down" style="flex:1;">⤓ ล่าง</button></div>' +
      '<button class="btn-brass" type="button" id="cc-ok" style="width:100%;margin-bottom:8px;">✓ ใช้ตำแหน่งนี้</button>' +
      '<button class="btn-g" type="button" id="cc-x" style="width:100%;">ยกเลิก</button></div>';
    document.body.appendChild(box);
    var q = function (id) { return box.querySelector("#" + id); };
    var fr = q("cc-frame"), cv = q("cc-cv"), zoom = q("cc-zoom"), zv = q("cc-zv");

    function paint() {
      var w = fr.clientWidth || 300, h = Math.round(w * ih / iw), d = Math.min(2, window.devicePixelRatio || 1);
      if (cv.width !== Math.round(w * d)) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); }
      var g = region(img, iw, ih, c), x = cv.getContext("2d");
      x.imageSmoothingQuality = "high";
      x.drawImage(img, g.sx, g.sy, g.sw, g.sh, 0, 0, cv.width, cv.height);
      zoom.value = Math.round(c.z * 100); zv.textContent = Math.round(c.z * 100) + "%";
    }
    // เลื่อนตามนิ้ว: ระยะบนจอ → ระยะในรูปต้นฉบับ → สัดส่วนของส่วนที่เลื่อนได้
    function pan(dx, dy) {
      var g = region(img, iw, ih, c), k = g.sw / (fr.clientWidth || 1), sx = img.width - g.sw, sy = img.height - g.sh;
      if (sx > 0.5) c.x = clamp((g.sx - dx * k) / sx, 0, 1);
      if (sy > 0.5) c.y = clamp((g.sy - dy * k) / sy, 0, 1);
    }
    // ซูมโดยจุดกลางที่เห็นอยู่ไม่ขยับ
    function setZoom(z) {
      var g = region(img, iw, ih, c), cx = g.sx + g.sw / 2, cy = g.sy + g.sh / 2;
      c.z = clamp(z, 1, ZMAX);
      var n = region(img, iw, ih, c), sx = img.width - n.sw, sy = img.height - n.sh;
      c.x = sx > 0.5 ? clamp((cx - n.sw / 2) / sx, 0, 1) : 0.5;
      c.y = sy > 0.5 ? clamp((cy - n.sh / 2) / sy, 0, 1) : c.y;
    }
    var pts = {}, pinch = null;
    function dist() { var a = Object.keys(pts).map(function (k) { return pts[k]; }); return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1; }
    fr.addEventListener("pointerdown", function (e) {
      try { fr.setPointerCapture(e.pointerId); } catch (err) {}
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (Object.keys(pts).length === 2) pinch = { d: dist(), z: c.z };
      fr.style.cursor = "grabbing"; e.preventDefault();
    });
    fr.addEventListener("pointermove", function (e) {
      var p = pts[e.pointerId]; if (!p) return;
      var n = Object.keys(pts).length;
      if (n === 1) pan(e.clientX - p.x, e.clientY - p.y);
      p.x = e.clientX; p.y = e.clientY;
      if (n === 2 && pinch) setZoom(pinch.z * dist() / pinch.d);
      paint(); e.preventDefault();
    });
    function up(e) { delete pts[e.pointerId]; if (Object.keys(pts).length < 2) pinch = null; fr.style.cursor = "grab"; }
    fr.addEventListener("pointerup", up); fr.addEventListener("pointercancel", up);
    fr.addEventListener("wheel", function (e) { setZoom(c.z * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); paint(); e.preventDefault(); }, { passive: false });
    zoom.addEventListener("input", function () { setZoom(zoom.value / 100); paint(); });
    q("cc-up").addEventListener("click", function () { c.y = 0; paint(); });
    q("cc-mid").addEventListener("click", function () { c.x = 0.5; c.y = 0.5; paint(); });
    q("cc-down").addEventListener("click", function () { c.y = 1; paint(); });
    function close() { window.removeEventListener("resize", paint); if (box.parentNode) box.parentNode.removeChild(box); }
    q("cc-x").addEventListener("click", close);
    box.addEventListener("click", function (e) { if (e.target === box) close(); });
    q("cc-ok").addEventListener("click", function () {
      close();
      var r3 = function (v) { return Math.round(v * 1000) / 1000; };
      if (JSON.stringify(c) === first) return;
      l.media.crop = { x: r3(c.x), y: r3(c.y), z: r3(c.z) };
      l.updatedAt = nowISO();
      save({ noSnap: true, noCount: true });
      if (window.RC) { RC.cache = {}; RC.gtok = (RC.gtok || 0) + 1; }
      rcRender();
      if (typeof rcFillGallery === "function") try { rcFillGallery(); } catch (err) {}
      toast("เลื่อนรูปปกแล้ว — ใช้กับรูปส่งผู้ปกครองทุกแบบของคาบนี้");
    });
    window.addEventListener("resize", paint);
    requestAnimationFrame(paint);
  }
  window.__coverCropOpen = openCrop;
  window.__coverCrop = "on";
})();
