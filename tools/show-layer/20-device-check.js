/* ชั้นเว็บแอป: ตรวจว่ากล้องเครื่องนี้ส่งข้อมูลวิดีโอต่อเนื่องไหม — tools/update-show.py ฝังไฟล์นี้ไว้ท้าย show/index.html

   ทำไมต้องมี: บางเครื่องไม่ส่งข้อมูลวิดีโอออกมาระหว่างอัดเลย (ทั้ง MP4 และ WebM) ส่งทีเดียวตอนปิดไฟล์
   แอปเลยคิดว่าตัวอัดค้าง แล้วตัดเป็นส่วนใหม่ทุก 25 วินาที ("no data for 25s")
   ปุ่มนี้ลองอัดสั้น ๆ หลายแบบเพื่อแยกว่าติดที่ไหน
     • MediaRecorder จากกล้องตรง ๆ ทุกชนิดไฟล์ มี/ไม่มีคำขอคีย์เฟรม  → ติดที่ชนิดไฟล์หรือการตั้งคีย์เฟรมไหม
     • MediaRecorder จากภาพที่วาดผ่าน canvas (เต็มขนาด / ภาพเล็ก)   → ติดที่ภาพจากกล้อง หรือที่ตัวเข้ารหัสฮาร์ดแวร์
       (ภาพเล็กกว่า 640×480 เบราว์เซอร์มักใช้ตัวเข้ารหัสซอฟต์แวร์แทน)
     • WebCodecs เข้ารหัสเอง ฮาร์ดแวร์/ซอฟต์แวร์ โหมดเรียลไทม์        → ทางสำรองถ้า MediaRecorder ใช้ไม่ได้ทุกแบบ
   ผลอยู่ในกล่องให้คัดลอก และลงบันทึกเหตุขัดข้องด้วย ไม่แตะการอัดจริง ใช้ได้ตอนเปิดกล้องอยู่และยังไม่ได้อัด */
(function () {
  'use strict';
  try { void [$, log, toast, esc, bitrate, AUDIO_BPS, tracksLive, buildIndex, sleep, cfg]; }
  catch (e) { window.__devcheck = 'missing: ' + e.message; return; }

  const DUR = window.__checkDur || 10000;
  const anchor = Array.from(document.querySelectorAll('#setA p')).find(p => /อัปเดตทันที/.test(p.textContent));
  if (!anchor) { window.__devcheck = 'missing: anchor'; return; }

  const box = document.createElement('div');
  box.innerHTML = `
<h4>ตรวจเครื่องนี้</h4>
<p>ถ้าอัดแล้วถูกตัดเป็นส่วนสั้น ๆ ทุก 25 วินาที กดตรวจหนึ่งครั้ง แอปจะลองอัดสั้น ๆ หลายแบบ ราว 2 นาที วางเครื่องไว้เฉย ๆ ให้กล้องเห็นภาพที่ขยับบ้าง และอย่าสลับไปแอปอื่นระหว่างตรวจ</p>
<button class="btn" id="chkGo" style="width:100%">ตรวจว่ากล้องส่งข้อมูลต่อเนื่องไหม</button>
<p class="status" id="chkStat" role="status" aria-live="polite" style="margin-top:8px"></p>
<pre id="chkOut" hidden style="white-space:pre-wrap;word-break:break-word;font:inherit;font-size:13px;color:var(--paper);background:#0000008c;border-radius:var(--r1);padding:10px;margin:0 0 8px"></pre>
<button class="btn" id="chkCopy" style="width:100%" hidden>คัดลอกผลตรวจ</button>`;
  anchor.after(box);

  const okType = m => { try { return MediaRecorder.isTypeSupported(m); } catch(e){ return false; } };
  const pick = list => list.find(okType);
  function trials(){
    const h264 = pick(['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs="avc1.640033,mp4a.40.2"', 'video/mp4']);
    const hevc = pick(['video/mp4;codecs=hvc1,mp4a.40.2', 'video/mp4;codecs="hvc1.1.6.L153.B0,mp4a.40.2"']);
    const vp9 = pick(['video/webm;codecs=vp9,opus']);
    const vp8 = pick(['video/webm;codecs=vp8,opus', 'video/webm']);
    const wh264 = pick(['video/webm;codecs=h264,opus', 'video/x-matroska;codecs=avc1,opus']);
    const out = [];
    const fast = window.__checkFast || (vTrack.getSettings().frameRate || 30) > 40;
    if (h264) out.push({ k: 'A', name: 'MP4 H.264 แบบที่แอปใช้', mime: h264, kf: 2000 });
    if (vp9) out.push({ k: 'E', name: 'WebM VP9', mime: vp9, kf: 2000 });
    if (fast && h264) out.push({ k: 'A30', name: 'MP4 H.264 ลดเหลือ 30 เฟรม', mime: h264, kf: 2000, fps: 30 });
    if (fast && vp8) out.push({ k: 'E30', name: 'WebM VP8 ลดเหลือ 30 เฟรม', mime: vp8, kf: 2000, fps: 30 });
    if (h264) {
      out.push({ k: 'A0', name: 'MP4 H.264 ไม่ขอคีย์เฟรม', mime: h264 });
      out.push({ k: 'B', name: 'MP4 H.264 + ขอข้อมูลทุก 2 วิ', mime: h264, kf: 2000, req: true });
    }
    if (hevc) out.push({ k: 'D', name: 'MP4 HEVC', mime: hevc, kf: 2000 });
    if (vp8) out.push({ k: 'E0', name: 'WebM VP8 ไม่ขอคีย์เฟรม', mime: vp8 });
    if (wh264) out.push({ k: 'F', name: 'WebM/MKV H.264', mime: wh264, kf: 2000 });
    if (h264) out.push({ k: 'H', name: 'MP4 H.264 ผ่าน canvas เต็มขนาด', mime: h264, kf: 2000, canvas: 1 });
    if (vp8) out.push({ k: 'G', name: 'WebM VP8 ผ่าน canvas ภาพเล็ก', mime: vp8, canvas: 480 });
    out.push({ k: 'W1', name: 'WebCodecs H.264 ฮาร์ดแวร์', wc: 'avc1.640028', hw: 'prefer-hardware' });
    out.push({ k: 'W2', name: 'WebCodecs H.264 ซอฟต์แวร์', wc: 'avc1.640028', hw: 'prefer-software' });
    out.push({ k: 'W3', name: 'WebCodecs VP8 ซอฟต์แวร์', wc: 'vp8', hw: 'prefer-software' });
    return out;
  }

  // ภาพจากกล้องวาดลง canvas แล้วให้ MediaRecorder อัดจาก canvas แทน (longest = ขนาดด้านยาว, 1 = เต็มขนาด)
  function canvasSource(longest){
    const st = vTrack.getSettings(), W = st.width || 1280, H = st.height || 720;
    const k = longest === 1 ? 1 : Math.min(1, longest / Math.max(W, H));
    const c = document.createElement('canvas');
    c.width = Math.round(W * k / 2) * 2; c.height = Math.round(H * k / 2) * 2;
    const g = c.getContext('2d'), v = $('vid');
    let on = true;
    const draw = () => { if (!on) return; try { g.drawImage(v, 0, 0, c.width, c.height); } catch(e){} requestAnimationFrame(draw); };
    draw();
    const s = c.captureStream(30);
    return { stream: s, size: c.width + '×' + c.height, stop(){ on = false; s.getTracks().forEach(t => t.stop()); } };
  }
  function summarize(got, stopAt){
    const before = got.filter(g => g[0] < stopAt - 50);
    // ช่วงที่ห่างที่สุดที่ไม่มีข้อมูลเลย (นับตั้งแต่เริ่ม ระหว่างก้อน และก้อนสุดท้ายถึงตอนสั่งหยุด)
    let gap = 0, prev = 0;
    for (const g of before) { gap = Math.max(gap, g[0] - prev); prev = g[0]; }
    gap = Math.max(gap, stopAt - prev);
    return { first: before.length ? Math.round(before[0][0] / 100) / 10 : null, n: before.length, gap: Math.round(gap / 100) / 10,
             sent: before.reduce((a, g) => a + g[1], 0), total: got.reduce((a, g) => a + g[1], 0) };
  }
  // สำเนาภาพจากกล้องที่ลดเฟรมเรตลง (ไม่แตะกล้องที่เปิดอยู่)
  async function slowSource(fps){
    const v = vTrack.clone();
    try { await v.applyConstraints({ frameRate: { max: fps } }); } catch(e){}
    const s = new MediaStream(aTrack ? [v, aTrack] : [v]);
    return { stream: s, audio: true, size: Math.round(v.getSettings().frameRate || 0) + 'fps', stop(){ v.stop(); } };
  }
  async function mrTrial(t){
    const src = t.canvas ? canvasSource(t.canvas) : t.fps ? await slowSource(t.fps) : null;
    try {
      const o = { mimeType: t.mime, videoBitsPerSecond: bitrate() };
      if (!src || src.audio) o.audioBitsPerSecond = AUDIO_BPS;
      if (t.kf) o.videoKeyFrameIntervalDuration = t.kf;
      const MR = window.__NativeMediaRecorder || MediaRecorder;        // ตัวจริง ไม่ผ่านโหมดอัดผ่านตัวช่วย
      const r = new MR(src ? src.stream : stream, o), got = [], blobs = [];
      const t0 = performance.now();
      r.ondataavailable = e => { if (e.data && e.data.size) { got.push([performance.now() - t0, e.data.size]); blobs.push(e.data); } };
      const stopped = new Promise(res => { r.onstop = res; });
      r.start(2000);
      const iv = t.req ? setInterval(() => { try { r.requestData(); } catch(e){} }, 2000) : 0;
      await sleep(DUR);
      clearInterval(iv);
      const stopAt = performance.now() - t0;
      try { r.stop(); } catch(e){}
      await Promise.race([stopped, sleep(5000)]);
      const res = summarize(got, stopAt);
      if (src) res.extra = src.size;
      if (/mp4/.test(t.mime) && res.total) {
        try { res.frags = (await buildIndex(new Blob(blobs, { type: 'video/mp4' }))).fr.length; } catch(e){ res.frags = -1; }
      }
      return res;
    } finally { if (src) src.stop(); }
  }
  async function wcTrial(t){
    if (!window.VideoEncoder || !window.MediaStreamTrackProcessor) throw new Error('ไม่มี WebCodecs');
    const st = vTrack.getSettings(), w = (st.width || 1280) & ~1, h = (st.height || 720) & ~1;
    const ec = { codec: t.wc, width: w, height: h, bitrate: bitrate(), framerate: Math.round(st.frameRate || 30),
                 hardwareAcceleration: t.hw, latencyMode: 'realtime' };
    if (/^avc1/.test(t.wc)) ec.avc = { format: 'annexb' };
    let sup;
    try { sup = await VideoEncoder.isConfigSupported(ec); } catch (e) { throw new Error('ตั้งค่าไม่ได้ ' + (e.name || '')); }
    if (!sup || !sup.supported) throw new Error('เครื่องไม่รองรับ');
    const got = []; let err = null, frames = 0, dropped = 0;
    const t0 = performance.now();
    const enc = new VideoEncoder({ output: ch => got.push([performance.now() - t0, ch.byteLength]), error: e => { err = e; } });
    enc.configure(ec);
    const tr = vTrack.clone(), reader = new MediaStreamTrackProcessor({ track: tr }).readable.getReader();
    const guard = setTimeout(() => { try { reader.cancel(); } catch(e){} }, DUR + 1500);
    try {
      while (performance.now() - t0 < DUR && !err) {
        const r = await reader.read();
        if (r.done) break;
        const f = r.value;
        if (enc.encodeQueueSize > 4) { dropped++; f.close(); continue; }
        enc.encode(f, { keyFrame: frames % 60 === 0 }); frames++; f.close();
      }
    } finally {
      clearTimeout(guard);
      try { reader.cancel(); } catch(e){}
      tr.stop();
    }
    const stopAt = performance.now() - t0;
    try { await Promise.race([enc.flush(), sleep(5000)]); } catch(e){}
    try { enc.close(); } catch(e){}
    if (err) throw err;
    const res = summarize(got, stopAt);
    res.extra = 'ส่งเข้า ' + frames + ' เฟรม' + (dropped ? ' ทิ้ง ' + dropped : '') + ' ได้ออกมา ' + got.length + ' ก้อน';
    return res;
  }

  const mb = b => (b / 1e6).toFixed(1) + ' MB';
  let running = false;
  $('chkGo').onclick = async () => {
    if (running) return;
    if (typeof rec !== 'undefined' && rec) { toast('หยุดอัดก่อนถึงจะตรวจได้'); return; }
    if (!tracksLive()) { toast('เปิดกล้องก่อนถึงจะตรวจได้'); return; }
    running = true; $('chkGo').disabled = true; $('chkCopy').hidden = true;
    const st = vTrack.getSettings(), list = trials(), lines = [];
    const ua = (navigator.userAgent.match(/Android [\d.]+|iPhone OS [\d_]+|CPU OS [\d_]+|Mac OS X [\d_]+|Windows NT [\d.]+/) || [''])[0];
    const br = (navigator.userAgent.match(/(?:SamsungBrowser|EdgA|Edg|CriOS|Chrome|Version)\/[\d.]+/) || [''])[0];
    lines.push('ตรวจเครื่อง ' + new Date().toLocaleString('th-TH'));
    lines.push(ua + ' · ' + br + ' · ' + st.width + '×' + st.height + ' ' + Math.round(st.frameRate || 0) + 'fps · ' + (bitrate() / 1e6).toFixed(1) + ' Mbps' +
               ' · ตั้งไว้ ' + cfg.res + 'p ' + cfg.fps + 'fps' + (cfg.gest ? ' · เปิดอ่านนิ้ว' : '') + ' · ซีพียู ' + (navigator.hardwareConcurrency || '?'));
    const out = $('chkOut'); out.hidden = false; out.textContent = lines.join('\n');
    const R = {};
    try {
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        $('chkStat').textContent = 'กำลังลอง ' + (i + 1) + ' จาก ' + list.length + ': ' + t.name;
        let line;
        try {
          const r = t.wc ? await wcTrial(t) : await mrTrial(t);
          R[t.k] = r;
          const flow = !r.n ? 'ไม่ส่งจนปิดไฟล์' : r.gap <= 8 ? 'ต่อเนื่อง' : 'ส่งเป็นช่วง ๆ';
          line = t.k + ' ' + t.name + ': ' + flow + ' · ก้อนแรก ' + (r.first == null ? '-' : r.first + ' วิ') + ' · ห่างสุด ' + r.gap + ' วิ · ระหว่างอัด ' + r.n + ' ก้อน ' + mb(r.sent) +
                 ' · รวม ' + mb(r.total) + (r.frags != null ? ' · ท่อน ' + r.frags : '') + (r.extra ? ' · ' + r.extra : '');
        } catch (e) { line = t.k + ' ' + t.name + ': ใช้ไม่ได้ (' + ((e && (e.message || e.name)) || e) + ')'; }
        lines.push(line); log('check ' + line);
        out.textContent = lines.join('\n');
      }
      // อัดจากกล้องตรง ๆ ไม่ได้ แต่ผ่าน canvas ได้ → เปิดโหมดอัดผ่านตัวช่วยให้เลย
      if (R.A && !R.A.n && R.H && R.H.n && window.__relaySet) {
        window.__relaySet(true, 'device check');
        lines.push('→ เปิด "อัดผ่านตัวช่วย" ให้แล้ว');
        out.textContent = lines.join('\n');
      }
      $('chkStat').textContent = 'ตรวจเสร็จแล้ว กดคัดลอกแล้วส่งผลให้คนดูแลแอป';
      $('chkCopy').hidden = false;
    } finally { running = false; $('chkGo').disabled = false; }
  };
  $('chkCopy').onclick = () => {
    const text = $('chkOut').textContent;
    try { navigator.clipboard.writeText(text).then(() => toast('คัดลอกแล้ว'), () => toast('คัดลอกไม่ได้ กดค้างที่ข้อความแล้วเลือกทั้งหมดแทน')); }
    catch(e){ toast('คัดลอกไม่ได้ กดค้างที่ข้อความแล้วเลือกทั้งหมดแทน'); }
  };
  window.__devcheck = 'ok';
})();
