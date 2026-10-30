/* ชั้นเว็บแอป: อัดผ่านตัวช่วย (canvas) สำหรับเครื่องที่ไม่ส่งข้อมูลวิดีโอระหว่างอัด — tools/update-show.py ฝังไฟล์นี้ไว้ท้าย show/index.html

   อาการ: อัดจากกล้องตรง ๆ แล้วตัวเข้ารหัสไม่ปล่อยข้อมูลออกมาเลยจนปิดไฟล์ (ทุกชนิดไฟล์)
   แอปเลยตัดเป็นส่วนใหม่ทุก 25 วินาที ("no data for 25s") เจอจริงบน Samsung Internet 30 / Android
   ปุ่มตรวจเครื่องพบว่าถ้าวาดภาพจากกล้องลง canvas ก่อนแล้วอัดจาก canvas ข้อมูลออกมาทุก 2 วินาทีตามปกติ
   และ MP4 ยังแบ่งเป็นท่อน ตัดแยกเพลงได้เหมือนเดิม

   ทำงานยังไง: แทนที่ MediaRecorder ด้วยตัวที่ถ้าโหมดนี้เปิดอยู่และแอปส่งสตรีมกล้อง (ตัวแปร stream) มาให้อัด
   จะวาดภาพจาก <video id="vid"> ลง canvas ทุกเฟรม แล้วอัดภาพจาก canvas + เสียงไมค์ตัวเดิมแทน
   ตรรกะอัด/มาร์กเพลง/อัดต่ออัตโนมัติของแอปไม่ถูกแตะเลย
   เปิดเองอัตโนมัติเมื่อ (1) อัดแล้วโดนตัดเพราะกล้องไม่ส่งข้อมูลตั้งแต่ก้อนแรก หรือ (2) ปุ่มตรวจเครื่องพบอาการนี้
   ปิด/เปิดเองได้ในตั้งค่า → ภาพและเสียง

   ข้อจำกัด: ภาพมาจากการวาดบนหน้าจอ ถ้าออกจากแอปหรือจอดับ ภาพช่วงนั้นจะหยุด (แอปเตือนเรื่องนี้อยู่แล้ว)
   "หรี่จอ" ใช้ได้ปกติ เพราะหน้าแอปยังเปิดอยู่ */
(function () {
  'use strict';
  try { void [$, log, toast, LS, kick, renderStats, cfg]; }
  catch (e) { window.__relay = 'missing: ' + e.message; return; }
  const Native = window.MediaRecorder;
  if (!Native) { window.__relay = 'no MediaRecorder'; return; }
  window.__NativeMediaRecorder = Native;

  const relayOn = () => LS.get('as_relay', false) === true;
  function setRelay(v, why){
    LS.set('as_relay', !!v);
    const cb = $('relayOn'); if (cb) cb.checked = !!v;
    if (why) log('relay ' + (v ? 'on' : 'off') + ': ' + why);
  }
  window.__relaySet = setRelay;

  // วาดภาพจากกล้องลง canvas ตามเฟรมเรตของกล้อง แล้วเอาภาพจาก canvas + เสียงเดิมมาเป็นสตรีมใหม่
  function makeRelay(src){
    const v = $('vid'), st = (src.getVideoTracks()[0] || {}).getSettings ? src.getVideoTracks()[0].getSettings() : {};
    const w = v.videoWidth || st.width || 1280, h = v.videoHeight || st.height || 720;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { alpha: false });
    const fps = Math.max(15, Math.min(60, Math.round(st.frameRate || cfg.fps || 30)));
    const out = c.captureStream(fps), vt = out.getVideoTracks()[0];
    let alive = true, raf = 0, last = 0;
    const gap = 1000 / fps - 4;
    const draw = now => {
      if (!alive) return;
      raf = requestAnimationFrame(draw);
      if (now - last < gap) return;
      last = now;
      if (v.readyState >= 2) { try { g.drawImage(v, 0, 0, w, h); } catch(e){} }
    };
    raf = requestAnimationFrame(draw);
    return {
      stream: new MediaStream([vt].concat(src.getAudioTracks())),
      size: w + '×' + h + ' ' + fps + 'fps',
      stop(){ alive = false; cancelAnimationFrame(raf); try { vt.stop(); } catch(e){} }
    };
  }

  let live = null;
  class RelayRecorder extends Native {
    constructor(s, o){
      let relay = null;
      if (relayOn() && typeof stream !== 'undefined' && s && s === stream && s.getVideoTracks().length) {
        try { relay = makeRelay(s); } catch (e) { log('relay: ' + (e && e.message)); relay = null; }
      }
      try { super(relay ? relay.stream : s, o); }
      catch (e) { if (relay) relay.stop(); throw e; }
      this.__relay = relay;
      if (relay) {
        if (live) live.stop();
        live = relay;
        this.addEventListener('stop', () => { relay.stop(); if (live === relay) live = null; });
      }
    }
  }
  window.MediaRecorder = RelayRecorder;

  // โดนตัดเพราะกล้องไม่ส่งข้อมูลตั้งแต่ก้อนแรก ทั้งที่อัดจากกล้องตรง ๆ → ส่วนถัดไปอัดผ่านตัวช่วย
  const origKick = kick;
  kick = function (why) {
    try {
      if (/^no data/.test(String(why)) && typeof rec !== 'undefined' && rec && !rec.__relay && typeof seq !== 'undefined' && seq === 0 && !relayOn()) {
        setRelay(true, 'camera sent no data before ' + why);
        toast('เครื่องนี้ต้องอัดผ่านตัวช่วย เปิดให้แล้ว ส่วนถัดไปจะอัดต่อเนื่อง', 6000);
      }
    } catch(e){}
    return origKick.apply(this, arguments);
  };

  const origStats = renderStats;
  renderStats = function () {
    origStats.apply(this, arguments);
    if (typeof rec !== 'undefined' && rec && rec.__relay) $('stats').insertAdjacentHTML('beforeend', '<span>อัดผ่านตัวช่วย</span>');
  };

  // ตั้งค่า → ภาพและเสียง: สวิตช์เปิด/ปิด (อยู่เหนือปุ่มตรวจเครื่อง)
  const anchor = Array.from(document.querySelectorAll('#setA p')).find(p => /อัปเดตทันที/.test(p.textContent));
  if (anchor) {
    const box = document.createElement('div');
    box.innerHTML = '<h4>อัดผ่านตัวช่วย</h4>' +
      '<label class="chk"><input type="checkbox" id="relayOn"> เปิด (สำหรับเครื่องที่อัดแล้วถูกตัดเป็นส่วนทุก 25 วินาที)</label>' +
      '<p>วาดภาพจากกล้องผ่านตัวช่วยก่อนอัด ทำให้เครื่องที่ไม่ส่งข้อมูลระหว่างอัดกลับมาอัดต่อเนื่องได้ แอปเปิดให้เองเมื่อเจออาการนี้ ' +
      'ถ้าเปิดอยู่ อย่าสลับไปแอปอื่นระหว่างอัด ภาพช่วงนั้นจะหยุด</p>';
    anchor.after(box);
    $('relayOn').checked = relayOn();
    $('relayOn').onchange = () => setRelay($('relayOn').checked, 'user');
  }
  window.__relay = 'ok';
})();
