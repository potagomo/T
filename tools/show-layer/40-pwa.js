/* ชั้นเว็บแอป: ติดตั้งเป็นแอป + อัปเดต + ขอพื้นที่ถาวร — tools/update-show.py ฝังไฟล์นี้ไว้ท้าย show/index.html

   • ลงทะเบียน show/sw.js → เปิดแอปได้ตอนไม่มีเน็ต
   • มีรุ่นใหม่: ขึ้นแถบให้กดอัปเดตเอง และไม่ยอมรีโหลดระหว่างอัดเด็ดขาด
   • การ์ด "ติดตั้งเป็นแอป" บนหน้าแรก (ซ่อนเมื่อเปิดจากไอคอนแล้ว)
       Chrome: ปุ่มติดตั้ง · iPhone/iPad: วิธีเพิ่มไปยังหน้าจอโฮม
       Samsung Internet: แนะนำเปิดด้วย Chrome (เครื่องที่ตรวจแล้ว Samsung Internet อัดจากกล้องตรง ๆ ไม่ส่งข้อมูล
       ต้องอัดผ่านตัวช่วย ส่วน Chrome อัดได้ปกติ)
   • ขอพื้นที่ถาวร (navigator.storage.persist) ทุกครั้งที่เปิด เบราว์เซอร์จะไม่ลบวิดีโอทิ้งเองตอนเครื่องใกล้เต็ม */
(function () {
  'use strict';
  try { void [$, log, toast, LS]; } catch (e) { window.__pwa = 'missing: ' + e.message; return; }

  const UA = navigator.userAgent;
  const samsung = /SamsungBrowser/i.test(UA);
  const ios = /iPhone|iPad|iPod/i.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
  const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const busy = () => (typeof rec !== 'undefined' && !!rec) || (typeof resuming !== 'undefined' && !!resuming);

  try { navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {}); } catch(e){}

  /* ---------- Service Worker และการอัปเดต ---------- */
  let waiting = null, wantReload = false;
  function offerUpdate(w){
    waiting = w;
    let bar = $('pwaUpd');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'pwaUpd'; bar.className = 'drv';
      bar.innerHTML = '<div class="drv-h"><b>มีเวอร์ชันใหม่ของแอป</b></div><p>อัปเดตแล้ววิดีโอและการตั้งค่ายังอยู่ครบ</p>' +
        '<div class="row"><button class="btn solid" id="pwaUpdGo">อัปเดตตอนนี้</button></div>';
      $('home').insertBefore(bar, $('home').querySelector('.go').nextSibling);
      $('pwaUpdGo').onclick = () => {
        if (busy()) { toast('กำลังอัดอยู่ หยุดอัดก่อนค่อยอัปเดต'); return; }
        if (!waiting) { location.reload(); return; }
        wantReload = true;
        waiting.postMessage('skipWaiting');
        setTimeout(() => { if (wantReload && !busy()) location.reload(); }, 4000);
      };
    }
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (wantReload && !busy()) location.reload(); });
    navigator.serviceWorker.register('sw.js').then(reg => {
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(w); });
      });
      // เปิดค้างไว้นาน ๆ ก็ยังรู้ว่ามีรุ่นใหม่ (เช็กเฉพาะตอนไม่ได้อัด)
      setInterval(() => { if (!busy() && navigator.onLine) reg.update().catch(() => {}); }, 30 * 60000);
    }).catch(e => log('sw: ' + (e && e.message)));
  }

  /* ---------- การ์ดติดตั้งเป็นแอป ---------- */
  let prompt = null;
  const card = document.createElement('section');
  card.className = 'drv'; card.id = 'pwaCard'; card.hidden = true; card.setAttribute('aria-label', 'ติดตั้งเป็นแอป');
  const before = $('drvCard') || $('ready').nextSibling;
  $('home').insertBefore(card, before);
  const chromeLink = 'intent://' + location.host + location.pathname + '#Intent;scheme=https;package=com.android.chrome;end';
  function paint(){
    const later = LS.get('as_pwa_later', 0);
    const inst = standalone();
    if (inst && !samsung) { card.hidden = true; return; }
    if (!samsung && Date.now() < later) { card.hidden = true; return; }
    let body;
    if (samsung) {
      body = '<div class="drv-h"><b>แนะนำเปิดด้วย Chrome</b><span class="drv-tag warn">Samsung Internet</span></div>' +
        '<p>' + (inst ? 'แอปนี้ติดตั้งจาก Samsung Internet ' : '') + 'Samsung Internet บางเครื่องอัดจากกล้องตรง ๆ ไม่ได้ แอปต้องอัดผ่านตัวช่วยแทน ' +
        'เปิดด้วย Chrome แล้วติดตั้งจาก Chrome จะอัดได้เสถียรที่สุด' + (inst ? ' (ลบไอคอนเดิมได้)' : '') + '</p>' +
        '<div class="row"><a class="btn solid" href="' + chromeLink + '">เปิดใน Chrome</a></div>';
    } else if (prompt) {
      body = '<div class="drv-h"><b>ติดตั้งเป็นแอป</b></div><p>มีไอคอนบนหน้าจอ เปิดเต็มจอ ใช้ได้แม้ไม่มีเน็ต และเครื่องจะไม่ลบวิดีโอทิ้งเอง</p>' +
        '<div class="row"><button class="btn solid" data-p="install">ติดตั้งแอป</button><button class="btn ghost" data-p="later">ไว้ทีหลัง</button></div>';
    } else if (ios) {
      body = '<div class="drv-h"><b>ติดตั้งเป็นแอป</b></div><p>เปิดด้วย Safari → ปุ่มแชร์ → <b>เพิ่มไปยังหน้าจอโฮม</b></p>' +
        '<div class="row"><button class="btn ghost" data-p="later">ไว้ทีหลัง</button></div>';
    } else {
      body = '<div class="drv-h"><b>ติดตั้งเป็นแอป</b></div><p>เมนู ⋮ ของ Chrome → <b>ติดตั้งแอป</b> หรือ <b>เพิ่มลงในหน้าจอหลัก</b></p>' +
        '<div class="row"><button class="btn ghost" data-p="later">ไว้ทีหลัง</button></div>';
    }
    card.innerHTML = body; card.hidden = false;
  }
  card.addEventListener('click', async e => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    if (b.dataset.p === 'later') { LS.set('as_pwa_later', Date.now() + 14 * 86400000); paint(); return; }
    if (b.dataset.p === 'install' && prompt) {
      const p = prompt; prompt = null;
      try { p.prompt(); const r = await p.userChoice; log('pwa install: ' + (r && r.outcome)); } catch(err){}
      paint();
    }
  });
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); prompt = e; paint(); });
  window.addEventListener('appinstalled', () => { prompt = null; card.hidden = true; toast('ติดตั้งแล้ว เปิดจากไอคอน "อัดโชว์" บนหน้าจอได้เลย', 5000); });
  paint();
  window.__pwa = 'ok';
})();
