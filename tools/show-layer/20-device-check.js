/* ชั้นเว็บแอป: ตรวจว่ากล้องเครื่องนี้ส่งข้อมูลวิดีโอต่อเนื่องไหม — tools/update-show.py ฝังไฟล์นี้ไว้ท้าย show/index.html

   ทำไมต้องมี: บางเครื่องส่งข้อมูล MP4 ออกมาตอนปิดไฟล์ทีเดียว แอปเลยคิดว่าตัวอัดค้าง
   แล้วตัดเป็นส่วนใหม่ทุก 25 วินาที ("no data for 25s") ปุ่มนี้ลองอัดสั้น ๆ ทุกแบบที่เครื่องรองรับ
   แล้วบอกว่าแบบไหนส่งข้อมูลระหว่างอัดได้จริง ผลอยู่ในกล่องให้คัดลอก และลงบันทึกเหตุขัดข้องด้วย
   ไม่แตะการอัดจริง ใช้ได้เฉพาะตอนเปิดกล้องอยู่และยังไม่ได้อัด */
(function () {
  'use strict';
  try { void [$, log, toast, esc, bitrate, AUDIO_BPS, tracksLive, buildIndex, sleep]; }
  catch (e) { window.__devcheck = 'missing: ' + e.message; return; }

  const DUR = window.__checkDur || 12000;
  const anchor = Array.from(document.querySelectorAll('#setA p')).find(p => /อัปเดตทันที/.test(p.textContent));
  if (!anchor) { window.__devcheck = 'missing: anchor'; return; }

  const box = document.createElement('div');
  box.innerHTML = `
<h4>ตรวจเครื่องนี้</h4>
<p>ถ้าอัดแล้วถูกตัดเป็นส่วนสั้น ๆ ทุก 25 วินาที กดตรวจหนึ่งครั้ง แอปจะลองอัดสั้น ๆ ทุกชนิดไฟล์ที่เครื่องนี้ทำได้ ราว 1–2 นาที วางเครื่องไว้เฉย ๆ ระหว่างตรวจ</p>
<button class="btn" id="chkGo" style="width:100%">ตรวจว่ากล้องส่งข้อมูลต่อเนื่องไหม</button>
<p class="status" id="chkStat" role="status" aria-live="polite" style="margin-top:8px"></p>
<pre id="chkOut" hidden style="white-space:pre-wrap;word-break:break-word;font:inherit;font-size:13px;color:var(--paper);background:#0000008c;border-radius:var(--r1);padding:10px;margin:0 0 8px"></pre>
<button class="btn" id="chkCopy" style="width:100%" hidden>คัดลอกผลตรวจ</button>`;
  anchor.after(box);

  function trials(){
    const ok = m => { try { return MediaRecorder.isTypeSupported(m); } catch(e){ return false; } };
    const pick = list => list.find(ok);
    const h264 = pick(['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs="avc1.640033,mp4a.40.2"', 'video/mp4']);
    const hevc = pick(['video/mp4;codecs=hvc1,mp4a.40.2', 'video/mp4;codecs="hvc1.1.6.L153.B0,mp4a.40.2"']);
    const vp9 = pick(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']);
    const wh264 = pick(['video/webm;codecs=h264,opus', 'video/x-matroska;codecs=avc1,opus']);
    const out = [];
    if (h264) {
      out.push({ k: 'A', name: 'MP4 H.264 แบบที่แอปใช้', mime: h264, kf: 2000 });
      out.push({ k: 'B', name: 'MP4 H.264 + ขอข้อมูลทุก 2 วิ', mime: h264, kf: 2000, req: true });
      out.push({ k: 'C', name: 'MP4 H.264 คีย์เฟรมทุก 60 เฟรม', mime: h264, kfc: 60 });
    }
    if (hevc) out.push({ k: 'D', name: 'MP4 HEVC', mime: hevc, kf: 2000 });
    if (vp9) out.push({ k: 'E', name: 'WebM VP9', mime: vp9, kf: 2000 });
    if (wh264) out.push({ k: 'F', name: 'WebM/MKV H.264', mime: wh264, kf: 2000 });
    return out;
  }
  async function trial(t){
    const o = { mimeType: t.mime, videoBitsPerSecond: bitrate(), audioBitsPerSecond: AUDIO_BPS };
    if (t.kf) o.videoKeyFrameIntervalDuration = t.kf;
    if (t.kfc) o.videoKeyFrameIntervalCount = t.kfc;
    const r = new MediaRecorder(stream, o), got = [], blobs = [];
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
    const before = got.filter(g => g[0] < stopAt - 50);
    // ช่วงที่ห่างที่สุดที่ไม่มีข้อมูลเลย (นับตั้งแต่เริ่ม ระหว่างก้อน และก้อนสุดท้ายถึงตอนสั่งหยุด)
    let gap = 0, prev = 0;
    for (const g of before) { gap = Math.max(gap, g[0] - prev); prev = g[0]; }
    gap = Math.max(gap, stopAt - prev);
    const res = { first: before.length ? Math.round(before[0][0] / 100) / 10 : null, n: before.length, gap: Math.round(gap / 100) / 10,
                  sent: before.reduce((a, g) => a + g[1], 0), total: got.reduce((a, g) => a + g[1], 0), frags: null };
    if (/mp4/.test(t.mime) && res.total) {
      try { res.frags = (await buildIndex(new Blob(blobs, { type: 'video/mp4' }))).fr.length; } catch(e){ res.frags = -1; }
    }
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
    lines.push(ua + ' · ' + br + ' · ' + st.width + '×' + st.height + ' ' + Math.round(st.frameRate || 0) + 'fps · ' + (bitrate() / 1e6).toFixed(1) + ' Mbps');
    const out = $('chkOut'); out.hidden = false; out.textContent = lines.join('\n');
    try {
      if (!list.length) lines.push('เบราว์เซอร์นี้อัดวิดีโอไม่ได้เลย');
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        $('chkStat').textContent = 'กำลังลอง ' + (i + 1) + ' จาก ' + list.length + ': ' + t.name;
        let line;
        try {
          const r = await trial(t);
          const flow = !r.n ? 'ไม่ส่งจนปิดไฟล์' : r.gap <= 8 ? 'ต่อเนื่อง' : 'ส่งเป็นช่วง ๆ';
          line = t.k + ' ' + t.name + ': ' + flow + ' · ก้อนแรก ' + (r.first == null ? '-' : r.first + ' วิ') + ' · ห่างสุด ' + r.gap + ' วิ · ระหว่างอัด ' + r.n + ' ก้อน ' + mb(r.sent) +
                 ' · รวม ' + mb(r.total) + (r.frags != null ? ' · ท่อน ' + r.frags : '');
        } catch (e) { line = t.k + ' ' + t.name + ': อัดไม่ได้ (' + ((e && (e.name || e.message)) || e) + ')'; }
        lines.push(line); log('check ' + line);
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
