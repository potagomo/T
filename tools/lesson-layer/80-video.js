/* ชั้นเว็บแอป: แนบคลิปวิดีโอให้คาบ — tools/update-lesson.py ฝังไฟล์นี้ไว้ท้าย lesson/index.html
   แก้ที่ tools/lesson-layer/80-video.js แล้วรัน update-lesson.py อย่าแก้ใน index.html ตรง ๆ

   เดิมช่อง "คลิป / รูปของคาบนี้" รับแค่รูปและ GIF ไม่เกิน 12 MB
   ชั้นนี้ให้แนบวิดีโอ (ไม่เกิน 10 นาที) ได้ด้วย แล้วส่งตัวไฟล์ไป LINE ตรง ๆ ผ่านเมนูแชร์ของเครื่อง
   ผู้ปกครองกดเล่นในแชตได้ทันที ไม่ต้องสมัครหรือเปิดลิงก์ใด ๆ

   ที่เก็บ:
   • ตัววิดีโอ (Blob) อยู่ใน IndexedDB ของเครื่องที่แนบ ที่คีย์ "vid:<id>" — ไม่ซิงค์ ไม่เข้าไฟล์สำรอง
     (วิดีโอหลายร้อย MB จะทำโควตา Firestore ฟรีเต็มและทำให้ซิงค์คาบพังทั้งหมด)
   • ภาพหน้าปก (เฟรมจากคลิป + ปุ่ม ▶ + ความยาว) อยู่ที่ "media:<id>" / "thumb:<id>" แบบรูปเดิม
     จึงซิงค์ไปอีกเครื่อง เข้าการ์ดรายงาน และไฟล์สำรองได้ตามปกติ */
(function () {
  "use strict";
  var NEED = ["pickMedia", "removeMedia", "mediaBlockHtml", "shareClip", "rcActionsHtml", "pendPut", "pendDel", "mediaKey", "thumbKey",
              "shrinkImage", "fmtBytes", "toast", "save", "startApp", "esc", "displayName"];
  for (var i = 0; i < NEED.length; i++) if (typeof window[NEED[i]] !== "function") {
    window.__video = "missing:" + NEED[i];
    return;
  }
  var MAX_SEC = 10 * 60, WARN_SEC = 5 * 60, MAX_BYTES = 2 * 1024 * 1024 * 1024;
  function vidKey(id) { return "vid:" + id; }
  function el(id) { return document.getElementById(id); }
  function isVideoMedia(m) { return !!(m && m.video); }
  function mmss(s) { s = Math.round(s || 0); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }
  function lessonById(id) { return S.lessons.find(function (l) { return l.id === id; }); }

  /* ── อ่านคลิป: ความยาว + ภาพหน้าปก ── */
  function drawBadge(ctx, w, h, dur) {
    var r = Math.max(18, Math.round(Math.min(w, h) * 0.13));
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = Math.max(2, r * 0.08); ctx.strokeStyle = "#FFFFFF"; ctx.stroke();
    ctx.fillStyle = "#FFFFFF"; ctx.beginPath();
    ctx.moveTo(w / 2 - r * 0.32, h / 2 - r * 0.45); ctx.lineTo(w / 2 + r * 0.5, h / 2); ctx.lineTo(w / 2 - r * 0.32, h / 2 + r * 0.45);
    ctx.closePath(); ctx.fill();
    if (dur) {
      var fs = Math.max(14, Math.round(Math.min(w, h) * 0.06)), t = "▶ " + mmss(dur);
      ctx.font = "700 " + fs + "px sans-serif";
      var tw = ctx.measureText(t).width, px = fs * 0.5, bh = fs * 1.6, x = w - tw - px * 2 - fs * 0.6, y = h - bh - fs * 0.6;
      ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.fillRect(x, y, tw + px * 2, bh);
      ctx.fillStyle = "#FFFFFF"; ctx.textBaseline = "middle"; ctx.fillText(t, x + px, y + bh / 2);
    }
  }
  function posterFrom(video, dur) {
    var vw = video && video.videoWidth, vh = video && video.videoHeight;
    var w = vw ? Math.min(1280, vw) : 960, h = vw ? Math.round(w * vh / vw) : 540;
    var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    var ctx = cv.getContext("2d");
    ctx.fillStyle = "#16140F"; ctx.fillRect(0, 0, w, h);
    if (vw) { try { ctx.drawImage(video, 0, 0, w, h); } catch (e) {} }
    else { ctx.fillStyle = "#F0E9DA"; ctx.font = "700 40px sans-serif"; ctx.textAlign = "center"; ctx.fillText("🥁 คลิปวิดีโอ", w / 2, h * 0.25); ctx.textAlign = "start"; }
    drawBadge(ctx, w, h, dur);
    return cv.toDataURL("image/jpeg", 0.85);
  }
  // คืน {dur, poster} เสมอ — เครื่องที่ถอดรหัสคลิปไม่ได้ก็ยังได้หน้าปกแบบเรียบ ๆ
  function probe(file) {
    return new Promise(function (res) {
      var url = URL.createObjectURL(file), v = document.createElement("video"), done = false, dur = 0;
      function fin(withFrame) {
        if (done) return; done = true;
        var poster = posterFrom(withFrame ? v : null, dur);
        try { v.removeAttribute("src"); v.load(); } catch (e) {}
        URL.revokeObjectURL(url);
        res({ dur: dur, poster: poster });
      }
      v.muted = true; v.playsInline = true; v.setAttribute("playsinline", ""); v.preload = "auto";
      v.onloadedmetadata = function () {
        dur = isFinite(v.duration) ? v.duration : 0;
        try { v.currentTime = Math.min(1, dur * 0.25 || 0.1); } catch (e) { fin(false); }
        // Safari บางรุ่นไม่ยอมเลื่อนเฟรมจนกว่าจะเล่น: เล่นเงียบ ๆ แป๊บเดียวแล้วจับเฟรม
        setTimeout(function () { if (!done) { var p = v.play(); if (p && p.then) p.then(function () { v.pause(); setTimeout(function () { fin(v.videoWidth > 0); }, 150); }, function () {}); } }, 2500);
      };
      v.onseeked = function () { fin(v.videoWidth > 0); };
      v.onerror = function () { fin(false); };
      setTimeout(function () { fin(v.readyState >= 2 && v.videoWidth > 0); }, 8000);
      v.src = url;
    });
  }

  /* ── ช่องแนบไฟล์: รับรูป (แบบเดิม) และวิดีโอ ── */
  var old = el("media-inp");
  var inp = old.cloneNode(false);                     // โคลนเพื่อตัดตัวจัดการเดิม (รับแค่รูป) ออก
  inp.setAttribute("accept", "image/*,video/*");
  old.parentNode.replaceChild(inp, old);
  inp.addEventListener("change", function (e) {
    var file = e.target.files && e.target.files[0], id = EF && EF.id;
    e.target.value = "";
    if (!file || id == null) return;
    var video = (file.type && file.type.indexOf("video") === 0) || /\.(mov|mp4|m4v|webm|3gp)$/i.test(file.name || "");
    return video ? attachVideo(file, id) : attachImage(file, id);
  });
  function redraw() { var mb = el("media-block"); if (mb) mb.innerHTML = mediaBlockHtml(); }
  function attachImage(file, id) {
    if (file.size > MEDIA_MAX) { toast("รูปใหญ่เกิน " + fmtBytes(MEDIA_MAX) + " — ลองย่อก่อน"); return; }
    var r = new FileReader();
    r.onload = function (ev) {
      var full = ev.target.result;
      shrinkImage(full, 480, 0.8).then(function (thumb) {
        if (!thumb) { toast("ไฟล์นี้อ่านเป็นรูปไม่ได้"); return; }
        if (EF.id !== id) return;
        pendDel(vidKey(id));
        pendPut(mediaKey(id), full); pendPut(thumbKey(id), thumb);
        EF.media = { type: file.type || "image/*", name: file.name || "clip", size: file.size };
        redraw(); toast("แนบแล้ว — จะเก็บลงเครื่องเมื่อกดบันทึก");
      }).catch(function () { toast("แนบไม่สำเร็จ — พื้นที่อาจไม่พอ"); });
    };
    r.onerror = function () { toast("อ่านไฟล์ไม่สำเร็จ"); };
    r.readAsDataURL(file);
  }
  function attachVideo(file, id) {
    if (file.size > MAX_BYTES) { toast("คลิปใหญ่เกิน " + fmtBytes(MAX_BYTES) + " — ตัดให้สั้นลงก่อน"); return; }
    var mb = el("media-block");
    if (mb) mb.innerHTML = '<div class="hint" style="padding:16px;text-align:center;border:2px dashed rgba(0,0,0,0.5);">กำลังอ่านคลิป…</div>';
    probe(file).then(function (info) {
      if (EF.id !== id) return;
      if (info.dur > MAX_SEC) { redraw(); toast("คลิปยาว " + mmss(info.dur) + " — แนบได้ไม่เกิน 10 นาที ตัดให้สั้นลงก่อน"); return; }
      return shrinkImage(info.poster, 480, 0.8).then(function (thumb) {
        if (EF.id !== id) return;
        pendPut(vidKey(id), file); pendPut(mediaKey(id), info.poster); pendPut(thumbKey(id), thumb || info.poster);
        EF.media = { type: file.type || "video/mp4", name: file.name || "clip.mp4", size: file.size, video: true, dur: Math.round(info.dur) };
        redraw();
        toast(info.dur > WARN_SEC
          ? "แนบแล้ว · คลิปยาวเกิน 5 นาที LINE อาจตัดหรือไม่ยอมส่ง"
          : "แนบคลิปแล้ว — กดบันทึกเพื่อเก็บ · คลิปอยู่ในเครื่องนี้เท่านั้น");
      });
    }).catch(function () { redraw(); toast("อ่านคลิปไม่สำเร็จ"); });
  }

  /* ── กล่องในฟอร์มคาบ ── */
  var origBlock = window.mediaBlockHtml;
  window.mediaBlockHtml = function () {
    if (!isVideoMedia(EF.media)) {
      return origBlock.apply(this, arguments).replace("แนบรูป / GIF ที่นักเรียนตีกลองคาบนี้", "แนบรูป / GIF / คลิปวิดีโอ ที่นักเรียนตีกลองคาบนี้");
    }
    var th = pendThumb(thumbKey(EF.id), THUMB[EF.id]), m = EF.media;
    return '<div style="border:2px solid rgba(0,0,0,0.62);background:rgba(255,217,61,0.35);border-radius:3px;padding:11px;">' +
      (th ? '<button type="button" onclick="playLessonVideo(EF.id)" aria-label="เล่นคลิป" style="display:block;width:100%;padding:0;border:0;background:none;margin-bottom:10px;cursor:pointer;">' +
        '<img alt="" src="' + esc(th) + '" style="width:100%;max-height:220px;object-fit:cover;border-radius:3px;display:block;"></button>' : '') +
      '<div class="mono" style="font-size:11px;color:#8A5A00;margin-bottom:8px;">🎬 คลิป ' + mmss(m.dur) + ' · ' + fmtBytes(m.size) + ' · เก็บในเครื่องนี้</div>' +
      '<div style="display:flex;gap:6px;">' +
        '<button class="btn-g" type="button" onclick="playLessonVideo(EF.id)" style="flex:1;padding:6px 8px;font-size:12.5px;min-height:40px;">▶ ดู</button>' +
        '<button class="btn-g" type="button" onclick="pickMedia()" style="flex:1;padding:6px 8px;font-size:12.5px;min-height:40px;">เปลี่ยน</button>' +
        '<button class="btn-g" type="button" onclick="removeMedia()" style="flex:1;padding:6px 8px;font-size:12.5px;min-height:40px;color:#B91C1C;">ลบ</button>' +
      '</div></div>';
  };
  var origRemove = window.removeMedia;
  window.removeMedia = function () { var id = EF.id; origRemove.apply(this, arguments); pendDel(vidKey(id)); };

  /* ── หาไฟล์วิดีโอ (ที่ยังไม่บันทึกก่อน แล้วค่อยในเครื่อง) ── */
  function videoBlob(id) {
    var k = vidKey(id);
    if (typeof PEND !== "undefined" && PEND.puts && PEND.puts[k]) return Promise.resolve(PEND.puts[k]);
    if (typeof PEND !== "undefined" && PEND.dels && PEND.dels[k]) return Promise.resolve(null);
    return MDB.get(k).then(function (b) { return b && b.size ? b : null; });
  }
  var MISSING = "ไฟล์คลิปอยู่ในเครื่องที่แนบไว้ (คลิปวิดีโอไม่ซิงค์) — เปิดจากเครื่องนั้น";

  /* ── ตัวเล่นในแอป (ซ้อนบนฟอร์มได้ ไม่ปิดหน้าที่เปิดอยู่) ── */
  function playLessonVideo(id) {
    videoBlob(id).then(function (blob) {
      if (!blob) { toast(MISSING); return; }
      var url = URL.createObjectURL(blob), box = document.createElement("div");
      box.id = "vid-player"; box.className = "overlay";
      box.style.cssText = "z-index:1200;background:rgba(0,0,0,0.92);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;";
      box.innerHTML = '<video controls playsinline autoplay style="max-width:100%;max-height:80vh;background:#000;border:2px solid #fff;"></video>' +
        '<button type="button" class="btn-g" style="margin-top:14px;min-width:140px;">✕ ปิด</button>';
      var v = box.querySelector("video");
      function close() { try { v.pause(); } catch (e) {} if (box.parentNode) box.parentNode.removeChild(box); URL.revokeObjectURL(url); document.removeEventListener("keydown", onKey, true); }
      function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }
      box.querySelector("button").addEventListener("click", close);
      box.addEventListener("click", function (e) { if (e.target === box) close(); });
      document.addEventListener("keydown", onKey, true);
      v.src = url;
      document.body.appendChild(box);
    });
  }
  window.playLessonVideo = playLessonVideo;

  // แตะภาพหน้าปกในการ์ดคาบ (มีปุ่ม ▶ อยู่ในรูป) แล้วเล่นคลิปเลย
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || t.tagName !== "IMG" || t.closest("#media-block") || t.closest(".rc-preview")) return;
    var src = t.getAttribute("src");
    var l = S.lessons.find(function (x) { return isVideoMedia(x.media) && THUMB[x.id] === src; });
    if (l) { e.preventDefault(); e.stopPropagation(); playLessonVideo(l.id); }
  }, true);

  /* ── ส่งคลิป: ตัวไฟล์ไป LINE / แอปอื่นตรง ๆ ── */
  function shareFile(blob, name, title) {
    var type = blob.type || "video/mp4";
    var f = new File([blob], name, { type: type });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [f] })) return navigator.share({ files: [f], title: title });
    // Chrome ไม่ยอมแชร์ .mov — ไฟล์ MOV/MP4 โครงเดียวกัน ส่งในชื่อ .mp4 แล้ว LINE เล่นได้
    var g = new File([blob], name.replace(/\.[^.]+$/, "") + ".mp4", { type: "video/mp4" });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [g] })) return navigator.share({ files: [g], title: title });
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    toast("เครื่องนี้แชร์ไฟล์ตรง ๆ ไม่ได้ — บันทึกคลิปลงเครื่องแล้ว ส่งจากแกลเลอรีได้");
    return Promise.resolve();
  }
  var origShareClip = window.shareClip;
  window.shareClip = function (id) {
    var l = lessonById(id);
    if (!l || !isVideoMedia(l.media)) return origShareClip.apply(this, arguments);
    videoBlob(id).then(function (blob) {
      if (!blob) { toast(MISSING); return; }
      var base = String(displayName(l.student)).replace(/[\\/:*?"<>|\s]+/g, "") + "-" + l.date;
      var ext = (/\.([a-z0-9]{2,4})$/i.exec(l.media.name || "") || [, "mp4"])[1].toLowerCase();
      return shareFile(blob, base + "." + ext, displayName(l.student) + " — คลิปคาบเรียน");
    }).catch(function () {});
  };
  var origActions = window.rcActionsHtml;
  window.rcActionsHtml = function () {
    origActions.apply(this, arguments);
    var l = typeof rcLesson === "function" ? rcLesson() : null, box = el("rc-actions");
    if (!l || !box || !isVideoMedia(l.media)) return;
    var b = box.querySelector('button[onclick^="shareClip("]');
    if (!b) return;
    b.textContent = "🎬 ส่งคลิปวิดีโอ " + mmss(l.media.dur);
    b.className = "btn-brass"; b.style.width = "100%";
    // วางต่อจากปุ่มส่งรูป: ส่งรูปสรุป แล้วแตะส่งคลิปต่อ
    var first = box.querySelector("button");
    if (first && first !== b && first.nextSibling !== b) first.parentNode.insertBefore(b, first.nextSibling);
  };

  /* ── เก็บกวาด: คลิปของคาบที่ถูกลบถาวร หรือเปลี่ยนเป็นรูปแล้ว ── */
  var sweepT = null;
  function sweep() {
    MDB.keys("vid:").then(function (ks) {
      var live = {};
      S.lessons.forEach(function (l) { if (isVideoMedia(l.media)) live[String(l.id)] = 1; });
      S.trash.forEach(function (t) { if (t && t.type === "lesson" && t.data && isVideoMedia(t.data.media)) live[String(t.data.id)] = 1; });
      var pend = (typeof PEND !== "undefined" && PEND.puts) || {};
      ks.forEach(function (k) { if (!live[k.slice(4)] && !pend[k]) MDB.del(k); });
    }).catch(function () {});
  }
  var origSave = window.save;
  window.save = function () {
    var r = origSave.apply(this, arguments);
    clearTimeout(sweepT); sweepT = setTimeout(sweep, 5000);
    return r;
  };
  var origStart = window.startApp;
  window.startApp = function () { var r = origStart.apply(this, arguments); setTimeout(sweep, 8000); return r; };

  window.__videoSweep = sweep;
  window.__video = "on";
})();
