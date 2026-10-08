/* ชั้นเว็บแอป: แนบคลิปวิดีโอให้คาบ — tools/update-lesson.py ฝังไฟล์นี้ไว้ท้าย lesson/index.html
   แก้ที่ tools/lesson-layer/80-video.js แล้วรัน update-lesson.py อย่าแก้ใน index.html ตรง ๆ

   เดิมช่อง "คลิป / รูปของคาบนี้" รับแค่รูปและ GIF ไม่เกิน 12 MB
   ชั้นนี้ให้แนบวิดีโอ (ไม่เกิน 10 นาที) ได้ด้วย แล้วส่งตัวไฟล์ไป LINE ตรง ๆ ผ่านเมนูแชร์ของเครื่อง
   ผู้ปกครองกดเล่นในแชตได้ทันที ไม่ต้องสมัครหรือเปิดลิงก์ใด ๆ

   ที่เก็บ:
   • ตัววิดีโอ (Blob) อยู่ใน IndexedDB ของเครื่องที่แนบ ที่คีย์ "vid:<id>" — ไม่ซิงค์ ไม่เข้าไฟล์สำรอง
     (วิดีโอหลายร้อย MB จะทำโควตา Firestore ฟรีเต็มและทำให้ซิงค์คาบพังทั้งหมด)
   • ภาพหน้าปก (เฟรมจากคลิป) อยู่ที่ "media:<id>" — การ์ดรายงานที่ส่งเป็นรูปใช้ภาพนี้ จึงไม่มีปุ่ม ▶ ปลอม
     ภาพย่อในแอป "thumb:<id>" มีปุ่ม ▶ + ความยาว (แตะแล้วเล่นได้จริง) · ทั้งสองซิงค์ไปอีกเครื่องแบบรูปเดิม

   ย่อคลิป: Chrome แชร์ไฟล์ได้รวมไม่เกิน 50 MB (kMaxSharedFileBytes ใน Chromium) คลิปจากกล้องมือถือ 1 นาทีก็เกินแล้ว
   แชร์จะล้มเงียบ ๆ — คลิปที่ใหญ่เกิน 48 MB จึงถูกย่อในเครื่องเป็น MP4 720p (H.264) ด้วย WebCodecs
   ผ่าน mediabunny (MPL-2.0, lesson/vendor/mediabunny-1.59.1.js โหลดเฉพาะตอนต้องย่อ) เสียงคัดลอกตรง ๆ ไม่แปลง
   ตั้ง bitrate ให้ทั้งไฟล์ไม่เกินราว 44 MB · ย่อไม่ได้ (เครื่องไม่มีตัวเข้ารหัส) ก็เก็บไฟล์เดิมและบอกให้ส่งจากแกลเลอรี */
(function () {
  "use strict";
  var NEED = ["pickMedia", "removeMedia", "mediaBlockHtml", "shareClip", "rcActionsHtml", "pendPut", "pendDel", "mediaKey", "thumbKey",
              "shrinkImage", "fmtBytes", "toast", "save", "startApp", "esc", "displayName"];
  for (var i = 0; i < NEED.length; i++) if (typeof window[NEED[i]] !== "function") {
    window.__video = "missing:" + NEED[i];
    return;
  }
  var MAX_SEC = 10 * 60, WARN_SEC = 5 * 60, MAX_BYTES = 2 * 1024 * 1024 * 1024;
  var MB_URL = "vendor/mediabunny-1.59.1.js";
  // ชุดทดสอบลดเพดานได้ผ่าน window.__videoLimits (ไม่ต้องสร้างไฟล์ 50 MB)
  function lim(k, d) { var o = window.__videoLimits; return (o && o[k]) || d; }
  function shareMax() { return lim("share", 48 * 1024 * 1024); }
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
  // คืน {poster, badged}: poster = เฟรมล้วน (ไปการ์ดรายงาน) · badged = มีปุ่ม ▶ + ความยาว (ภาพย่อในแอป)
  function posterFrom(video, dur) {
    var vw = video && video.videoWidth, vh = video && video.videoHeight;
    var w = vw ? Math.min(1280, vw) : 960, h = vw ? Math.round(w * vh / vw) : 540;
    var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    var ctx = cv.getContext("2d");
    ctx.fillStyle = "#16140F"; ctx.fillRect(0, 0, w, h);
    if (vw) { try { ctx.drawImage(video, 0, 0, w, h); } catch (e) {} }
    else { ctx.fillStyle = "#F0E9DA"; ctx.font = "700 40px sans-serif"; ctx.textAlign = "center"; ctx.fillText("🥁 คลิปวิดีโอ", w / 2, h * 0.5); ctx.textAlign = "start"; }
    var poster = cv.toDataURL("image/jpeg", 0.85);
    drawBadge(ctx, w, h, dur);
    return { poster: poster, badged: cv.toDataURL("image/jpeg", 0.85) };
  }
  // คืน {dur, poster, badged} เสมอ — เครื่องที่ถอดรหัสคลิปไม่ได้ก็ยังได้หน้าปกแบบเรียบ ๆ
  function probe(file) {
    return new Promise(function (res) {
      var url = URL.createObjectURL(file), v = document.createElement("video"), done = false, dur = 0;
      function fin(withFrame) {
        if (done) return; done = true;
        var pics = posterFrom(withFrame ? v : null, dur);
        try { v.removeAttribute("src"); v.load(); } catch (e) {}
        URL.revokeObjectURL(url);
        res({ dur: dur, poster: pics.poster, badged: pics.badged });
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

  /* ── ย่อคลิปให้ส่งได้ (WebCodecs ผ่าน mediabunny) ── */
  var mbP = null;
  function loadMB() {
    if (!mbP) mbP = import(new URL(MB_URL, location.href).href).catch(function (e) { mbP = null; throw e; });
    return mbP;
  }
  function pickCodec(M) {
    var list = window.__videoCodecs || ["avc"];       // ชุดทดสอบใส่ vp9 แทนได้ (Chromium ของ Playwright ไม่มี H.264)
    return list.reduce(function (p, c) { return p.then(function (got) { return got || M.canEncodeVideo(c).then(function (ok) { return ok ? c : null; }, function () { return null; }); }); }, Promise.resolve(null));
  }
  // คืน Promise<Blob video/mp4> · onProgress(0..1) · ผลยังเกินเพดาน (เสียงเดิม bitrate สูง) ย่อซ้ำอีกรอบที่ bitrate ต่ำลง
  function compress(blob, dur, onProgress) {
    return compressOnce(blob, dur, onProgress, 1).then(function (out) {
      if (out.size <= shareMax()) return out;
      return compressOnce(blob, dur, onProgress, 0.85 * shareMax() / out.size).then(function (again) {
        if (again.size > shareMax()) throw new Error("ย่อแล้วยังใหญ่ " + fmtBytes(again.size) + " — ตัดคลิปให้สั้นลง");
        return again;
      });
    });
  }
  function compressOnce(blob, dur, onProgress, scale) {
    if (typeof VideoEncoder === "undefined") return Promise.reject(new Error("เครื่องนี้ย่อคลิปไม่ได้ (ไม่มี WebCodecs)"));
    return loadMB().then(function (M) {
      return pickCodec(M).then(function (codec) {
        if (!codec) throw new Error("เครื่องนี้ไม่มีตัวเข้ารหัส H.264");
        var input = new M.Input({ source: new M.BlobSource(blob), formats: M.ALL_FORMATS });
        var target = new M.BufferTarget();
        var output = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: "in-memory" }), target: target });
        return input.computeDuration().then(function (d) {
          d = d || dur || 60;
          // เผื่อเสียงเดิมที่คัดลอกมาตรง ๆ ได้ถึง 320 kbps (Samsung อัด 256 kbps)
          var vbps = Math.max(lim("minBps", 400000), Math.min(2500000, Math.floor((lim("target", 44 * 1024 * 1024) * 8 / d - 320000) * scale)));
          return M.Conversion.init({
            input: input, output: output, tracks: "primary",
            video: function (track) {
              return Promise.all([track.getDisplayWidth(), track.getDisplayHeight(), track.computePacketStats(90).catch(function () { return null; })]).then(function (r) {
                var o = { codec: codec, bitrate: vbps, keyFrameInterval: 2, forceTranscode: true };
                if (Math.max(r[0], r[1]) > 1280) { if (r[0] >= r[1]) o.width = 1280; else o.height = 1280; }
                if (r[2] && r[2].averagePacketRate > 31) o.frameRate = 30;
                return o;
              });
            },
            audio: {}                                      // ไม่ตั้งค่าอะไร = คัดลอกเสียงเดิม (AAC) ตรง ๆ ถ้าใส่ใน MP4 ได้
          });
        }).then(function (conv) {
          var lostVideo = conv.discardedTracks.filter(function (t) { return t.track.isVideoTrack(); })[0];
          if (!conv.isValid || lostVideo) throw new Error("ย่อคลิปนี้ไม่ได้ (" + (lostVideo ? lostVideo.reason : "ไม่รองรับ") + ")");
          if (onProgress) conv.onProgress = function (p) { onProgress(p); };
          return conv.execute().then(function () { return new Blob([target.buffer], { type: "video/mp4" }); });
        });
      });
    });
  }
  function progressHtml(title, p) {
    var pct = Math.round((p || 0) * 100);
    return '<div style="padding:14px;border:2px solid rgba(0,0,0,0.62);background:rgba(255,217,61,0.35);border-radius:3px;">' +
      '<div style="font-weight:700;margin-bottom:8px;">' + title + ' ' + pct + '%</div>' +
      '<div style="height:10px;border:2px solid #000;background:#fff;"><div style="height:100%;width:' + pct + '%;background:#000;"></div></div>' +
      '<div class="hint" style="margin-top:8px;">ย่อให้ส่ง LINE ได้ (ไม่เกิน 50 MB) · อยู่หน้านี้ไว้ก่อน</div></div>';
  }
  var BUSY = false;
  var origSaveLesson = window.saveLesson;
  if (typeof origSaveLesson === "function") window.saveLesson = function () {
    if (BUSY) { toast("รอย่อคลิปเสร็จก่อน แล้วค่อยกดบันทึก"); return; }
    return origSaveLesson.apply(this, arguments);
  };

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
      var small = file.size <= shareMax(), note = "";
      BUSY = !small;
      var ready = small ? Promise.resolve(file) : compress(file, info.dur, function (p) {
        var b = el("media-block"); if (b && EF.id === id) b.innerHTML = progressHtml("กำลังย่อคลิป", p);
      }).then(function (out) {
        note = " · ย่อจาก " + fmtBytes(file.size) + " เหลือ " + fmtBytes(out.size);
        return out;
      }, function (e) {
        note = " · ย่อไม่ได้ (" + ((e && e.message) || "ไม่ทราบสาเหตุ") + ") — ส่งจากแกลเลอรีแทน";
        return file;
      });
      return ready.then(function (vid) {
        BUSY = false;
        if (EF.id !== id) return;
        return shrinkImage(info.badged, 480, 0.8).then(function (thumb) {
          if (EF.id !== id) return;
          var mp4 = vid !== file;
          pendPut(vidKey(id), vid); pendPut(mediaKey(id), info.poster); pendPut(thumbKey(id), thumb || info.badged);
          EF.media = { type: vid.type || file.type || "video/mp4", name: mp4 ? String(file.name || "clip").replace(/\.[^.]+$/, "") + ".mp4" : (file.name || "clip.mp4"),
            size: vid.size, video: true, dur: Math.round(info.dur), clean: 1 };
          redraw();
          toast((info.dur > WARN_SEC ? "แนบแล้ว · คลิปยาวเกิน 5 นาที LINE อาจตัดหรือไม่ยอมส่ง" : "แนบคลิปแล้ว — กดบันทึกเพื่อเก็บ") + note);
        });
      });
    }).catch(function () { BUSY = false; redraw(); toast("อ่านคลิปไม่สำเร็จ"); });
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
  function doShare(blob, name, title) {
    return shareFile(blob, name, title).then(function () { return true; }, function (e) {
      if (e && e.name === "AbortError") return false;              // กดยกเลิกเอง
      toast("ส่งไม่สำเร็จ: " + ((e && (e.message || e.name)) || "ไม่ทราบสาเหตุ") + " — ลองส่งจากแกลเลอรีแทน");
      return false;
    });
  }
  // แผ่นซ้อนบนการ์ดรายงาน (ไม่ปิดหน้าที่เปิดอยู่)
  function sheet(html) {
    var box = document.createElement("div");
    box.id = "vid-sheet"; box.className = "overlay";
    box.style.cssText = "z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,0.55);";
    box.innerHTML = '<div class="modal-box" style="max-width:380px;width:100%;"></div>';
    document.body.appendChild(box);
    var card = box.firstChild;
    var api = { set: function (h) { card.innerHTML = h; }, close: function () { if (box.parentNode) box.parentNode.removeChild(box); }, card: card };
    api.set(html);
    return api;
  }
  function saveAs(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }
  var origShareClip = window.shareClip;
  window.shareClip = function (id) {
    var l = lessonById(id);
    if (!l || !isVideoMedia(l.media)) return origShareClip.apply(this, arguments);
    var base = String(displayName(l.student)).replace(/[\\/:*?"<>|\s]+/g, "") + "-" + l.date;
    var title = displayName(l.student) + " — คลิปคาบเรียน";
    videoBlob(id).then(function (blob) {
      if (!blob) { toast(MISSING); return; }
      var ext = (/\.([a-z0-9]{2,4})$/i.exec(l.media.name || "") || [, "mp4"])[1].toLowerCase();
      if (blob.size <= shareMax()) return doShare(blob, base + "." + ext, title);
      // ใหญ่เกินที่ Chrome ยอมแชร์: ย่อก่อน แล้วให้แตะส่งอีกครั้ง (การแชร์ต้องเกิดจากการแตะ)
      var sh = sheet(progressHtml("กำลังย่อคลิปก่อนส่ง", 0));
      compress(blob, l.media.dur, function (p) { if (sh.card.isConnected) sh.set(progressHtml("กำลังย่อคลิปก่อนส่ง", p)); }).then(function (out) {
        return MDB.put(vidKey(id), out).then(function () {
          var cur = lessonById(id);
          if (cur && cur.media) {
            cur.media.size = out.size; cur.media.type = "video/mp4";
            cur.media.name = String(cur.media.name || "clip").replace(/\.[^.]+$/, "") + ".mp4";
            save({ noSnap: true, noCount: true });
          }
          sh.set('<div style="font-weight:700;font-size:16px;margin-bottom:6px;">✓ ย่อคลิปแล้ว</div>' +
            '<div class="hint" style="margin-bottom:14px;">' + fmtBytes(blob.size) + ' → ' + fmtBytes(out.size) + ' · ครั้งต่อไปส่งได้ทันที</div>' +
            '<button class="btn-brass" type="button" id="vid-go" style="width:100%;margin-bottom:8px;">🎬 ส่งคลิปเลย</button>' +
            '<button class="btn-g" type="button" id="vid-x" style="width:100%;">ปิด</button>');
          el("vid-go").addEventListener("click", function () { doShare(out, base + ".mp4", title).then(function (ok) { if (ok) sh.close(); }); });
          el("vid-x").addEventListener("click", sh.close);
        });
      }, function (e) {
        sh.set('<div style="font-weight:700;font-size:16px;margin-bottom:6px;">ส่งจากแอปไม่ได้</div>' +
          '<div class="hint" style="margin-bottom:10px;line-height:1.8;">คลิปใหญ่ ' + fmtBytes(blob.size) + ' เกินที่เบราว์เซอร์ยอมส่ง (50 MB) และย่อในเครื่องนี้ไม่สำเร็จ<br>' +
          'เปิด <b>แกลเลอรี</b> แล้วส่งคลิปเดิมไป LINE แทนได้เลย</div>' +
          '<div class="mono" style="font-size:10px;color:#5A5A5A;margin-bottom:14px;word-break:break-word;">สาเหตุ: ' + esc((e && e.message) || "ไม่ทราบ") + '</div>' +
          '<button class="btn-g" type="button" id="vid-dl" style="width:100%;margin-bottom:8px;">↓ บันทึกคลิปลงเครื่อง</button>' +
          '<button class="btn-g" type="button" id="vid-x" style="width:100%;">ปิด</button>');
        el("vid-dl").addEventListener("click", function () { saveAs(blob, base + "." + ext); });
        el("vid-x").addEventListener("click", sh.close);
      });
    }).catch(function (e) { toast("เปิดคลิปไม่สำเร็จ: " + ((e && e.message) || "")); });
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
  // คลิปที่แนบก่อนรุ่นนี้: ภาพในการ์ดรายงานมีปุ่ม ▶ ติดไปด้วย — ทำหน้าปกใหม่จากคลิปในเครื่อง
  function fixPosters() {
    var todo = S.lessons.filter(function (l) { return isVideoMedia(l.media) && !l.media.clean; });
    return todo.reduce(function (p, l) {
      return p.then(function () { return MDB.get(vidKey(l.id)); }).then(function (blob) {
        if (!blob || !blob.size) return;
        return probe(blob).then(function (info) {
          return shrinkImage(info.badged, 480, 0.8).then(function (thumb) {
            return MDB.put(mediaKey(l.id), info.poster).then(function () { return MDB.put(thumbKey(l.id), thumb || info.badged); }).then(function () {
              THUMB[l.id] = thumb || info.badged; l.media.clean = 1;
              try { if (SY && SY.st && SY.st.files) { delete SY.st.files[mediaKey(l.id)]; delete SY.st.files[thumbKey(l.id)]; sySave(); } } catch (e) {}
            });
          });
        });
      }).catch(function () {});
    }, Promise.resolve()).then(function () {
      if (todo.some(function (l) { return l.media.clean; })) { save({ noSnap: true, noCount: true }); try { if (!document.querySelector(".overlay")) renderAll(); } catch (e) {} }
    });
  }
  var origStart = window.startApp;
  window.startApp = function () { var r = origStart.apply(this, arguments); setTimeout(sweep, 8000); setTimeout(fixPosters, 4000); return r; };
  window.__videoFixPosters = fixPosters;
  window.__videoCompress = compress;

  window.__videoSweep = sweep;
  window.__video = "on";
})();
