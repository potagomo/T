/* ชั้นเว็บแอป: เก็บขึ้น Google Drive แบบเรียลไทม์ — tools/update-show.py ฝังไฟล์นี้ไว้ท้าย show/index.html

   ทำอะไร
     • ระหว่างอัด ส่งวิดีโอขึ้น Drive ตามไปทีละไม่กี่วินาที (resumable upload ไฟล์เดียวต่อหนึ่งส่วน)
       อ่านจาก IndexedDB ที่แอปเขียนอยู่แล้ว ไม่แตะตัวอัดเลย เน็ตหลุด/ปิดแอป/รีโหลด ก็ส่งต่อจากจุดเดิม
     • ชื่อโชว์ มาร์กเพลง ไฮไลต์ รายชื่อเพลงพร้อมเวลา เก็บเป็นไฟล์ .json ข้างวิดีโอ แก้เมื่อไหร่ก็ตามไป
       ส่งครบแล้ว รายชื่อเพลงพร้อมเวลาไปอยู่ในช่อง "คำอธิบาย" ของวิดีโอบน Drive ด้วย
     • เซ็ตลิสต์ซิงค์ระหว่างเครื่องที่เชื่อม Drive บัญชีเดียวกัน
     • ทุกอย่างอยู่ในโฟลเดอร์ "อัดโชว์" ใน Drive ของผู้ใช้เอง สิทธิ์ drive.file = แอปเห็นแค่ไฟล์ที่แอปสร้าง

   ที่ต้องรู้
     • ใช้ OAuth Client ID ของผู้ใช้เอง (Google Cloud ฟรี) ใส่ครั้งเดียวในแอป หรือใส่ไว้ที่ DEFAULT_CLIENT_ID
     • บัตรผ่านของ Google อยู่ได้ 1 ชั่วโมง และต่ออายุได้เฉพาะตอนผู้ใช้แตะ (ระบบเปิดหน้าต่างล็อกอินเองไม่ได้)
       แอปจึงต่ออายุให้ตอนแตะ "เปิดกล้อง" แล้วเปิดช่องส่งวิดีโอไว้ตั้งแต่เริ่มอัด
       ช่องส่งที่เปิดแล้วใช้ต่อได้ถึงหนึ่งสัปดาห์ วิดีโอจึงส่งต่อได้แม้โชว์ยาวเกินชั่วโมง
       ส่วนที่ต้องใช้บัตร (ไฟล์ .json ชื่อไฟล์ ส่วนต่อที่เกิดใหม่) จะรอจนแตะเชื่อมต่ออีกครั้ง
     • ไม่เคยเปิดหน้าต่างล็อกอินระหว่างอัด เพราะหน้าแอปจะหลุดไปอยู่ข้างหลังแล้วกล้องอาจดับ */
(function () {
  'use strict';
  try {
    void [$, esc, toast, log, LS, tx, sesRange, getSession, getSessions, fileName, chaptersText, sesName, fmtB,
          writeChunk, delSession, renderLib, openDetail, renderStats, enterCam, readSetlist];
  } catch (e) { window.__drive = 'missing: ' + e.message; return; }

  const DEFAULT_CLIENT_ID = '';                  // ใส่ Client ID ตรงนี้ได้ ทุกเครื่องจะไม่ต้องวางเอง
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const API = 'https://www.googleapis.com/drive/v3/';
  const UP = 'https://www.googleapis.com/upload/drive/v3/files';
  const FOLDER = 'อัดโชว์', SETFILE = 'เซ็ตลิสต์.json';
  const Q = 256 * 1024;                          // Drive รับทีละก้อนที่เป็นพหุคูณของ 256 KB (ยกเว้นก้อนสุดท้าย)
  const MIN_PIECE = window.__drivePiece || 16 * Q, MAX_PIECE = 128 * Q;   // 4 MB ถึง 32 MB ต่อครั้ง

  const D = Object.assign({ clientId: DEFAULT_CLIENT_ID, on: false, since: 0, video: true, wifiOnly: false, setSync: true,
                            folder: null, email: '', free: null, setAt: 0, setFile: null, files: {} }, LS.get('as_drive', {}));
  if (!D.clientId) D.clientId = DEFAULT_CLIENT_ID;
  const saveD = () => LS.set('as_drive', D);
  let tok = LS.get('as_drive_tok', null);
  const tokenOk = sec => !!(tok && tok.t && tok.exp - Date.now() > (sec || 60) * 1000);
  const ready = () => D.on && !!D.clientId;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* ---------- สไตล์ ---------- */
  const css = document.createElement('style');
  css.textContent = `
.drv{margin:20px 0 0;padding:14px 14px 12px;border:1px solid var(--line2);border-radius:var(--r2);background:#ffffff0a}
.drv-h{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 4px}
.drv-h b{font-size:17px}
.drv-tag{font-size:12px;font-weight:700;padding:2px 8px;border-radius:99px;border:1px solid var(--line2);color:var(--mute);white-space:nowrap}
.drv-tag.ok{color:var(--mark);border-color:#5fd3c480}
.drv-tag.warn{color:#000;background:var(--amber);border-color:var(--amber)}
.drv-tag.bad{color:#fff;background:var(--red);border-color:var(--red)}
.drv p{margin:0 0 10px;color:var(--mute);font-size:14px;font-variant-numeric:tabular-nums}
.drv .row{flex-wrap:wrap}
.drv-bar{height:6px;border-radius:99px;background:#ffffff1f;overflow:hidden;margin:0 0 10px}
.drv-bar i{display:block;height:100%;background:var(--mark);transition:width var(--med)}
.drv a.btn{text-decoration:none}
.lib .drvb{display:block;color:var(--mute)}
.lib .drvb.ok{color:var(--mark)}
.lib .drvb.warn{color:var(--amber)}
#drvSheet input[type=text]{display:block;width:100%;min-height:50px;border-radius:var(--r1);border:1px solid var(--line2);background:#000;padding:0 10px;font-size:15px}
#drvSheet code{font-family:inherit;color:var(--paper);background:#0000008c;padding:1px 6px;border-radius:6px;word-break:break-all}
#drvSheet .steps b{color:var(--paper)}`;
  document.head.appendChild(css);

  /* ---------- ล็อกอิน Google (Google Identity Services) ---------- */
  let gisP = null, client = null, waiters = [];
  const gisReady = () => !!(window.google && google.accounts && google.accounts.oauth2);
  function loadGis(){
    if (gisReady()) return Promise.resolve();
    if (gisP) return gisP;
    gisP = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = () => res();
      s.onerror = () => { gisP = null; s.remove(); rej(new Error('โหลดระบบล็อกอิน Google ไม่ได้ ต้องต่อเน็ต')); };
      document.head.appendChild(s);
    });
    return gisP;
  }
  function settle(err){
    const w = waiters; waiters = [];
    w.forEach(f => f(err));
  }
  function tokenClient(){
    if (client && client._cid === D.clientId) return client;
    client = google.accounts.oauth2.initTokenClient({
      client_id: D.clientId, scope: SCOPE,
      callback: r => {
        const granted = r && r.access_token && (!google.accounts.oauth2.hasGrantedAllScopes || google.accounts.oauth2.hasGrantedAllScopes(r, SCOPE));
        if (!granted) { settle(new Error(r && r.error ? 'Google ปฏิเสธ (' + r.error + ')' : 'ยังไม่ได้อนุญาตให้แอปเก็บไฟล์ใน Drive')); return; }
        tok = { t: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3599) * 1000 };
        LS.set('as_drive_tok', tok);
        settle(null);
        afterSignIn();
      },
      error_callback: e => {
        const t = e && e.type;
        settle(new Error(t === 'popup_closed' ? 'ปิดหน้าต่างล็อกอินก่อนเสร็จ'
          : t === 'popup_failed_to_open' ? 'เบราว์เซอร์บล็อกหน้าต่างล็อกอิน อนุญาตป๊อปอัปให้เว็บนี้แล้วลองใหม่'
          : 'ล็อกอิน Google ไม่สำเร็จ'));
      }
    });
    client._cid = D.clientId;
    return client;
  }
  // ต้องเรียกตรงจากการแตะเท่านั้น ห้ามมี await ก่อนหน้า ไม่งั้นเบราว์เซอร์บล็อกหน้าต่างล็อกอิน
  function signIn(){
    return new Promise((res, rej) => {
      if (!D.clientId) { rej(new Error('ยังไม่ได้ใส่ Client ID')); return; }
      if (!gisReady()) { loadGis().catch(() => {}); rej(new Error('กำลังโหลดระบบล็อกอิน Google อีกสักครู่แตะอีกครั้ง')); return; }
      waiters.push(err => err ? rej(err) : res());
      try {
        const o = { prompt: '' };
        if (D.email) o.login_hint = D.email;
        tokenClient().requestAccessToken(o);
      } catch (e) { settle(new Error('ล็อกอิน Google ไม่สำเร็จ ตรวจ Client ID อีกครั้ง')); }
    });
  }
  function signOut(){
    try { if (tok && gisReady()) google.accounts.oauth2.revoke(tok.t, () => {}); } catch(e){}
    tok = null; LS.set('as_drive_tok', null);
  }

  /* ---------- คุยกับ Drive ---------- */
  function authErr(){ const e = new Error('ต้องเชื่อมต่อ Google Drive อีกครั้ง'); e.auth = true; return e; }
  async function driveErr(r){
    let reason = '';
    try { const j = await r.json(); reason = (j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason) || (j.error && (j.error.status || j.error.message)) || ''; } catch(e){}
    const e = new Error('Drive ตอบ ' + r.status + (reason ? ' ' + reason : ''));
    e.status = r.status; e.reason = reason;
    e.full = /storageQuotaExceeded|quotaExceeded/i.test(reason);
    e.retry = r.status >= 500 || r.status === 429 || /rateLimitExceeded/i.test(reason);
    if (r.status === 401) { tok = null; LS.set('as_drive_tok', null); e.auth = true; }
    return e;
  }
  async function api(method, url, body, type){
    if (!tokenOk(20)) throw authErr();
    const h = { Authorization: 'Bearer ' + tok.t };
    if (type) h['Content-Type'] = type;
    const r = await fetch(url, { method, headers: h, body });
    if (!r.ok) throw await driveErr(r);
    return r.status === 204 ? null : r.json();
  }
  const qs = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  let folderP = null;                            // เรียกพร้อมกันหลายทาง ต้องได้โฟลเดอร์เดียว ไม่สร้างซ้ำ
  function folder(){
    if (D.folder) return Promise.resolve(D.folder);
    return folderP || (folderP = findOrMakeFolder().finally(() => { folderP = null; }));
  }
  async function findOrMakeFolder(){
    const q = 'mimeType=' + qs('application/vnd.google-apps.folder') + ' and name=' + qs(FOLDER) + ' and trashed=false';
    const r = await api('GET', API + 'files?pageSize=1&fields=files(id)&q=' + encodeURIComponent(q));
    let id = r.files && r.files[0] && r.files[0].id;
    if (!id) id = (await api('POST', API + 'files?fields=id', JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' }), 'application/json; charset=UTF-8')).id;
    D.folder = id; saveD();
    return id;
  }
  async function findInFolder(name){
    const q = 'name=' + qs(name) + ' and ' + qs(await folder()) + ' in parents and trashed=false';
    const r = await api('GET', API + 'files?pageSize=1&orderBy=modifiedTime desc&fields=files(id)&q=' + encodeURIComponent(q));
    return r.files && r.files[0] ? r.files[0].id : null;
  }
  // สร้าง/แก้ไฟล์เล็ก (JSON) ทีเดียวทั้งชื่อและเนื้อ — ไฟล์ถูกลบไปจาก Drive ก็สร้างใหม่ให้
  async function putJson(id, name, obj){
    const b = 'as' + Math.random().toString(36).slice(2);
    const meta = id ? { name } : { name, parents: [await folder()], mimeType: 'application/json' };
    const body = '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) +
                 '\r\n--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(obj, null, 1) + '\r\n--' + b + '--';
    try {
      return (await api(id ? 'PATCH' : 'POST', UP + (id ? '/' + id : '') + '?uploadType=multipart&fields=id', body, 'multipart/related; boundary=' + b)).id;
    } catch (e) {
      if (id && e.status === 404) return putJson(null, name, obj);
      if (!id && e.status === 404) { D.folder = null; saveD(); }
      throw e;
    }
  }
  async function refreshAbout(){
    try {
      const a = await api('GET', API + 'about?fields=user(emailAddress),storageQuota(limit,usage)');
      if (a.user && a.user.emailAddress) D.email = a.user.emailAddress;
      const q = a.storageQuota || {};
      D.free = q.limit ? Math.max(0, Number(q.limit) - Number(q.usage || 0)) : null;
      D.aboutAt = Date.now(); saveD();
    } catch (e) { if (!e.auth) log('drive about: ' + e.message); }
  }

  /* ---------- สถานะของแต่ละโชว์ ----------
     D.files[sid] = { uri: ช่องส่งวิดีโอ, sent: ไบต์ที่ Drive ได้แล้ว, done, vid: id วิดีโอบน Drive,
                      meta: id ไฟล์ .json, metaSig, vidSig: ชื่อ+คำอธิบายที่ตั้งไว้แล้ว, err } */
  const st = { phase: 'idle', msg: '', live: 0 };
  let backoff = 0, until = 0;
  const tracked = s => !!D.files[s.id] || (D.since && s.id >= D.since);
  function fileOf(s){ return D.files[s.id] || (D.files[s.id] = { uri: null, sent: 0, done: false, vid: null, meta: null, metaSig: '', vidSig: '' }); }
  const baseName = s => fileName(s) + (s.part > 1 ? '-ส่วนที่' + s.part : '');
  const onCell = () => { const c = navigator.connection; return !!(D.wifiOnly && c && c.type === 'cellular'); };

  /* สารบัญก้อนวิดีโอใน IndexedDB ของแต่ละโชว์ (อ่านเฉพาะก้อนที่เพิ่มมาใหม่ ไม่โหลดตัววิดีโอขึ้นหน่วยความจำ) */
  const lay = {};
  async function layout(s, done){
    let L = lay[s.id];
    if (!L) L = lay[s.id] = { seq: [], end: [], last: 0, total: 0, closed: false };
    if (L.closed) return L;
    const rows = await tx('chunks', 'readonly', st => st.getAll(IDBKeyRange.bound([s.id, L.last + 1], [s.id, Infinity])));
    for (const r of rows || []) {
      // ระหว่างอัด รับเฉพาะก้อนที่ต่อเนื่อง (ก้อนที่เขียนซ้ำอาจลงช้ากว่าก้อนถัดไป) อัดจบแล้วรับทั้งหมด
      if (!done && r.seq !== L.last + 1) break;
      const n = (r.blob && r.blob.size) || 0;
      L.total += n; L.seq.push(r.seq); L.end.push(L.total); L.last = r.seq;
    }
    if (done) L.closed = true;
    return L;
  }
  async function readRange(sid, L, a, b){
    let i = 0, lo = 0, hi = L.end.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (L.end[m] > a) { i = m; hi = m - 1; } else lo = m + 1; }
    let j = i;
    while (j < L.end.length - 1 && L.end[j] < b) j++;
    const rows = await tx('chunks', 'readonly', st => st.getAll(IDBKeyRange.bound([sid, L.seq[i]], [sid, L.seq[j]])));
    const byseq = new Map((rows || []).map(r => [r.seq, r.blob]));
    const parts = [];
    for (let k = i; k <= j; k++) {
      const bl = byseq.get(L.seq[k]);
      if (!bl) throw new Error('ข้อมูลวิดีโอในเครื่องหายไประหว่างส่ง');
      parts.push(bl);
    }
    const start = i ? L.end[i - 1] : 0;
    return new Blob(parts).slice(a - start, b - start);
  }

  /* ส่งวิดีโอหนึ่งก้อน คืน true ถ้าได้ทำอะไรไปแล้ว */
  let ctrl = null, upSid = 0;
  async function openUpload(s, F){
    if (!tokenOk(20)) throw authErr();
    const r = await fetch(UP + '?uploadType=resumable&fields=id', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + tok.t, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': s.mime || 'video/mp4' },
      body: JSON.stringify({ name: baseName(s) + '.' + (s.ext || 'mp4'), parents: [await folder()], mimeType: s.mime || 'video/mp4' })
    });
    if (!r.ok) {
      const e = await driveErr(r);
      if (r.status === 404) { D.folder = null; saveD(); e.retry = true; }    // โฟลเดอร์ถูกลบไปจาก Drive สร้างใหม่รอบหน้า
      throw e;
    }
    const uri = r.headers.get('Location');
    if (!uri) throw new Error('Drive ไม่ส่งที่อยู่สำหรับอัปโหลดกลับมา');
    F.uri = uri; F.sent = 0; F.check = false; F.nul = 0; saveD();
  }
  async function put(F, headers, body, size){
    const h = Object.assign({}, headers);
    if (tokenOk(20)) h.Authorization = 'Bearer ' + tok.t;     // ช่องส่งที่เปิดแล้วไม่ต้องใช้บัตรก็ได้ แต่มีก็แนบไป
    ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.max(60000, size / 40000 * 1000));   // ช้ากว่า 40 KB/วินาที = ถือว่าค้าง
    try { return await fetch(F.uri, { method: 'PUT', headers: h, body, signal: ctrl.signal }); }
    finally { clearTimeout(timer); ctrl = null; }
  }
  // ถาม Drive ว่าได้ไปแล้วกี่ไบต์ (หลังเน็ตหลุดหรือเปิดแอปใหม่)
  async function askSent(F){
    const r = await put(F, { 'Content-Range': 'bytes */*' }, null, 0);
    return answer(F, r, F.sent, null);
  }
  async function answer(F, r, b, total){
    if (r.status === 200 || r.status === 201) {
      let j = {}; try { j = await r.json(); } catch(e){}
      F.vid = j.id || F.vid; F.done = true; F.uri = null; F.sent = total != null ? total : F.sent; F.vidSig = ''; F.err = '';
      saveD(); return 'done';
    }
    if (r.status === 308) {
      const range = r.headers.get('Range');
      if (range) { F.sent = Number(range.match(/(\d+)\s*$/)[1]) + 1; F.nul = 0; }
      else if (b > 0 && F.sent > 0) F.sent = b;                       // อ่านหัว Range ไม่ได้ ถือว่าก้อนนี้ถึงแล้ว
      else if (b > 0 && ++F.nul >= 2) { F.sent = b; log('drive: no Range header'); }
      else F.sent = 0;
      saveD(); return 'more';
    }
    if (r.status === 404 || r.status === 410) {                       // ช่องส่งหมดอายุ (เกิน 1 สัปดาห์) เริ่มส่งใหม่ทั้งไฟล์
      log('drive: upload session expired, restart'); F.uri = null; F.sent = 0; saveD(); return 'more';
    }
    throw await driveErr(r);
  }
  async function pushVideo(s, F, live){
    if (F.done || !D.video || F.err === 'full') return false;
    const L = await layout(s, !live);
    if (!F.uri) {
      if (live && !L.total) return false;          // เปิดช่องส่งตั้งแต่ก้อนแรก ตอนที่บัตรยังสดอยู่
      if (!live && !L.total) { F.done = true; saveD(); return false; }
      await openUpload(s, F);
    }
    upSid = s.id;
    if (F.check && F.uri) { F.check = false; if (await askSent(F) === 'done') return true; }
    const a = F.sent;
    let b, total = null;
    if (live) {
      const n = Math.min(MAX_PIECE, Math.floor((L.total - a) / Q) * Q);
      if (n < MIN_PIECE) return false;
      b = a + n;
    } else {
      total = L.total;                                                 // อัดจบแล้ว รู้ขนาดรวม บอกไปทุกก้อน
      if (a > total) { F.sent = 0; F.check = true; return true; }
      b = a + Math.min(MAX_PIECE, total - a);
    }
    const body = b > a ? await readRange(s.id, L, a, b) : null;
    const range = b > a ? 'bytes ' + a + '-' + (b - 1) + '/' + (live ? '*' : total) : 'bytes */' + total;
    let r;
    try { r = await put(F, { 'Content-Range': range }, body, b - a); }
    catch (e) { F.check = true; throw Object.assign(new Error('ส่งไม่สำเร็จ ' + ((e && e.name) || '')), { retry: true }); }
    await answer(F, r, b, live ? null : total);
    return true;
  }
  function metaOf(s, F){
    return { app: 'อัดโชว์', v: 1, id: s.id, title: s.title || '', name: sesName(s).name, part: s.part || 1,
             recorded: new Date(s.id).toISOString(), duration: Math.round(s.dur || 0), bytes: s.bytes || 0,
             width: s.w, height: s.h, mime: s.mime, ext: s.ext, done: !!s.done, crashed: !!s.crashed,
             video: F.vid ? baseName(s) + '.' + s.ext : null, marks: s.marks || [], played: s.played || [],
             chapters: chaptersText(s) };
  }
  async function pushMeta(s, F, live){
    const m = metaOf(s, F), sig = JSON.stringify(m) + baseName(s);
    // วิดีโอส่งครบแล้ว: ตั้งชื่อให้ตรงกับชื่อโชว์ล่าสุด และใส่รายชื่อเพลงพร้อมเวลาไว้ในคำอธิบาย
    const name = baseName(s) + '.' + s.ext, desc = sesName(s).name + '\n\n' + chaptersText(s), vs = name + '\n' + desc;
    const wantMeta = sig !== F.metaSig, wantVid = !!(F.done && F.vid && vs !== F.vidSig);
    if (!wantMeta && !wantVid) return false;
    if (!tokenOk(20)) throw authErr();
    if (wantMeta && (!live || !F.metaAt || Date.now() - F.metaAt > 8000)) {      // ระหว่างอัด ส่งไม่ถี่กว่า 8 วินาที
      F.meta = await putJson(F.meta, baseName(s) + '.json', m);
      F.metaSig = sig; F.metaAt = Date.now(); saveD();
      return true;
    }
    if (wantVid) {
      try { await api('PATCH', API + 'files/' + F.vid + '?fields=id', JSON.stringify({ name, description: desc }), 'application/json; charset=UTF-8'); }
      catch (e) { if (e.status !== 404) throw e; }
      F.vidSig = vs; saveD();
      return true;
    }
    return false;
  }

  /* ---------- ตัวเดินงาน: ทีละก้อน โชว์ที่กำลังอัดก่อน ---------- */
  let running = false, again = false, list = null, listAt = 0;
  function nudge(){ if (running) again = true; else pump(); }
  async function sessions(){
    if (!list || Date.now() - listAt > 8000) { list = (await getSessions()) || []; listAt = Date.now(); }
    let out = list.filter(s => s && tracked(s) && !dropping.has(s.id));
    if (typeof ses !== 'undefined' && ses && tracked(ses)) out = out.filter(s => s.id !== ses.id).concat([ses]);
    return out;
  }
  async function step(){
    if (!ready()) { st.phase = 'off'; return false; }
    if (!navigator.onLine) { st.phase = 'offline'; return false; }
    if (Date.now() < until) return false;
    const cell = onCell();
    const live = (typeof ses !== 'undefined' && ses) ? ses.id : 0;
    const all = (await sessions()).sort((a, b) => (b.id === live) - (a.id === live) || a.id - b.id);
    let needAuth = false, did = false;
    if (!cell) for (const s of all) {
      const F = fileOf(s), isLive = s.id === live || !s.done;
      try {
        if (await pushVideo(s, F, isLive)) { did = true; break; }
      } catch (e) {
        if (e.auth) { needAuth = true; continue; }
        if (e.full) { F.err = 'full'; saveD(); st.phase = 'full'; continue; }
        throw e;
      }
    }
    if (!did) for (const s of all) {
      const F = fileOf(s);
      try { if (await pushMeta(s, F, s.id === live || !s.done)) { did = true; break; } }
      catch (e) { if (e.auth) needAuth = true; else throw e; }
    }
    if (!did && D.setSync) {
      try { did = await syncSetlist(); } catch (e) { if (e.auth) needAuth = true; else throw e; }
    }
    st.phase = did ? 'busy' : needAuth ? 'auth' : cell ? 'cell' : 'idle';
    return did;
  }
  async function pump(){
    if (running) { again = true; return; }
    running = true;
    try {
      do {
        again = false;
        if (await step()) { backoff = 0; again = true; paint(); }
      } while (again);
    } catch (e) {
      backoff = Math.min(60000, backoff ? backoff * 2 : 2000);
      until = Date.now() + backoff;
      st.phase = 'retry'; st.msg = e.message || String(e);
      if (backoff >= 16000) log('drive: ' + st.msg);
      setTimeout(nudge, backoff + 50);
    } finally { running = false; upSid = 0; paint(); }
  }

  /* ---------- เซ็ตลิสต์ระหว่างเครื่อง ---------- */
  let setPullAt = 0, setPushWant = false;
  async function syncSetlist(){
    if (!tokenOk(20)) return false;
    if (!D.setFile) {
      D.setFile = await findInFolder(SETFILE);
      if (!D.setFile) { setPushWant = true; }
      else setPullAt = 0;
      saveD();
    }
    if (setPushWant) {
      setPushWant = false;
      D.setFile = await putJson(D.setFile, SETFILE, { app: 'อัดโชว์', setlist: $('setlist').value, at: D.setAt || Date.now() });
      saveD();
      return true;
    }
    const home = !$('home').hidden && document.visibilityState === 'visible';
    if (D.setFile && home && Date.now() - setPullAt > 20000) {
      setPullAt = Date.now();
      let j;
      try { j = await api('GET', API + 'files/' + D.setFile + '?alt=media'); }
      catch (e) { if (e.status === 404) { D.setFile = null; saveD(); return false; } throw e; }
      const ta = $('setlist');
      if (j && typeof j.setlist === 'string' && (j.at || 0) > (D.setAt || 0) && document.activeElement !== ta) {
        if (ta.value !== j.setlist) {
          ta.value = j.setlist; LS.set('as_setlist', j.setlist); readSetlist();
          toast('เซ็ตลิสต์อัปเดตจากอีกเครื่องแล้ว');
        }
        D.setAt = j.at; saveD();
      } else if (j && (j.at || 0) < (D.setAt || 0)) setPushWant = true;
    }
    return false;
  }
  let setTimer = 0;
  $('setlist').addEventListener('input', () => {
    D.setAt = Date.now(); saveD();
    clearTimeout(setTimer);
    setTimer = setTimeout(() => { setPushWant = true; nudge(); }, 2500);
  });

  /* ---------- เกาะกับแอปเดิม ---------- */
  // ทุกก้อนวิดีโอที่ลง IndexedDB แล้ว ปลุกตัวส่ง
  const origWrite = writeChunk;
  writeChunk = function (row, tries) {
    const p = origWrite(row, tries);
    p.then(() => { if (ready()) nudge(); }, () => {});
    return p;
  };
  // ลบโชว์ออกจากแอป: ส่วนที่ส่งไปแล้วปิดเป็นไฟล์บน Drive ให้ (ไม่ทิ้งค้างเป็นช่องส่งที่ไม่มีใครเห็น)
  const dropping = new Set();
  const origDel = delSession;
  delSession = async function (id) {
    const F = D.files[id];
    dropping.add(id);
    try {
      if (upSid === id && ctrl) try { ctrl.abort(); } catch(e){}
      for (let i = 0; i < 50 && upSid === id; i++) await sleep(100);
      if (F && F.uri && !F.done && navigator.onLine) {
        const close = async () => {
          await askSent(F);
          if (!F.done && F.sent > 0) {
            const r = await put(F, { 'Content-Range': 'bytes */' + F.sent }, null, 0);
            await answer(F, r, F.sent, F.sent);
          }
        };
        try { await Promise.race([close(), sleep(10000)]); } catch (e) { log('drive close partial: ' + e.message); }
      }
      await origDel(id);
      delete D.files[id]; delete lay[id]; saveD();
      list = null;
    } finally { dropping.delete(id); }
  };
  // หน้ากล้อง: ต่ออายุบัตรตอนแตะ "เปิดกล้อง" (ระหว่างอัดจะไม่มีหน้าต่างเด้ง)
  $('openCam').onclick = () => {
    if (ready() && navigator.onLine && gisReady() && !tokenOk(50 * 60)) {
      let gone = false;
      const go = () => { if (!gone) { gone = true; enterCam(); } };
      signIn().then(go, e => { toast(e.message + ' วิดีโอยังอัดลงเครื่องตามปกติ', 4000); go(); });
      setTimeout(go, 60000);
      return;
    }
    enterCam();
  };
  const origStats = renderStats;
  renderStats = function () {
    origStats.apply(this, arguments);
    if (!ready() || typeof ses === 'undefined' || !ses || !D.files[ses.id]) return;
    const F = D.files[ses.id], L = lay[ses.id], lag = Math.max(0, (L ? L.total : ses.bytes) - F.sent);
    const txt = st.phase === 'offline' ? 'ไม่มีเน็ต ค้าง ' + fmtB(lag)
      : st.phase === 'cell' ? 'รอ Wi-Fi ค้าง ' + fmtB(lag)
      : st.phase === 'full' || F.err === 'full' ? 'Drive เต็ม'
      : !F.uri && !F.sent ? (tokenOk(20) ? 'กำลังเริ่ม' : 'รอเชื่อมต่อใหม่')
      : lag < 2 * MIN_PIECE ? 'ทัน' : 'ค้าง ' + fmtB(lag);
    $('stats').insertAdjacentHTML('beforeend', '<span' + (/ทัน/.test(txt) ? '' : ' class="k"') + '>Drive ' + esc(txt) + '</span>');
  };
  const origLib = renderLib;
  renderLib = async function () {
    await origLib.apply(this, arguments);
    paintLib().catch(() => {});
  };
  const origDetail = openDetail;
  openDetail = async function (id) {
    await origDetail.apply(this, arguments);
    paintDetail();
  };

  /* ---------- หน้าจอ ---------- */
  const card = document.createElement('section');
  card.className = 'drv'; card.id = 'drvCard'; card.setAttribute('aria-label', 'Google Drive');
  $('ready').after(card);
  const box = document.createElement('div');
  box.className = 'drv'; box.id = 'drvBox'; box.style.marginTop = '32px';
  const h2s = Array.from(document.querySelectorAll('#detail h2'));
  const anchor = h2s.find(h => /คืนพื้นที่/.test(h.textContent)) || $('dDel');
  anchor.before(box);

  function pct(F, total){ return total ? Math.min(100, Math.floor(F.sent / total * 100)) : 0; }
  function stateLine(){
    if (st.phase === 'offline') return ['warn', 'ไม่มีเน็ต', 'อัดลงเครื่องได้ตามปกติ เน็ตกลับมาจะส่งต่อเอง'];
    if (st.phase === 'cell') return ['warn', 'รอ Wi-Fi', 'ตั้งไว้ว่าไม่ส่งวิดีโอผ่านเน็ตมือถือ'];
    if (st.phase === 'full') return ['bad', 'Drive เต็ม', 'ลบไฟล์ใน Drive หรือเพิ่มพื้นที่ แล้วกดลองอีกครั้ง'];
    if (!tokenOk(20)) return ['warn', 'ต้องเชื่อมต่อใหม่', 'แตะเชื่อมต่อเพื่อส่งส่วนที่ค้าง (วิดีโอที่เปิดช่องส่งไว้แล้วยังส่งต่อได้เอง)'];
    if (st.phase === 'retry') return ['warn', 'กำลังลองใหม่', st.msg];
    if (st.phase === 'busy') return ['ok', 'กำลังส่ง', ''];
    return ['ok', 'เชื่อมแล้ว', ''];
  }
  async function backlog(){
    let n = 0, c = 0;
    for (const s of await sessions()) {
      const F = D.files[s.id];
      if (!F || F.done || !D.video) continue;
      n += Math.max(0, ((lay[s.id] && lay[s.id].closed ? lay[s.id].total : s.bytes) || 0) - F.sent); c++;
    }
    return { n, c };
  }
  async function paintCard(){
    if (!D.clientId || !D.on) {
      card.innerHTML = '<div class="drv-h"><b>เก็บขึ้น Google Drive</b><span class="drv-tag">ปิดอยู่</span></div>' +
        '<p>ส่งวิดีโอขึ้น Drive ของคุณตามไประหว่างอัด พร้อมรายชื่อเพลงและเวลา เครื่องพังหรือพื้นที่เต็มก็ไม่หาย</p>' +
        '<div class="row"><button class="btn" data-a="setup">ตั้งค่า Google Drive</button></div>';
      return;
    }
    const [k, tag, why] = stateLine(), b = await backlog();
    const lines = [];
    if (D.email) lines.push(esc(D.email));
    if (D.free != null) lines.push('Drive ว่าง ' + fmtB(D.free));
    if (b.c) lines.push('รอส่ง ' + fmtB(b.n) + ' (' + b.c + ' โชว์)');
    else lines.push('ส่งครบทุกโชว์แล้ว');
    let warn = '';
    if (D.free != null && b.n > D.free) warn = '<p style="color:var(--amber)">พื้นที่ Drive ไม่พอสำหรับวิดีโอที่รอส่ง</p>';
    card.innerHTML = '<div class="drv-h"><b>Google Drive</b><span class="drv-tag ' + k + '">' + tag + '</span></div>' +
      '<p>' + lines.join(' · ') + (why ? '<br>' + esc(why) : '') + '</p>' + warn +
      '<div class="row">' +
      (tokenOk(20) ? '' : '<button class="btn solid" data-a="auth">เชื่อมต่อ</button>') +
      (st.phase === 'full' || st.phase === 'retry' ? '<button class="btn" data-a="retry">ลองอีกครั้ง</button>' : '') +
      (D.folder ? '<a class="btn" href="https://drive.google.com/drive/folders/' + encodeURIComponent(D.folder) + '" target="_blank" rel="noopener">เปิดโฟลเดอร์</a>' : '') +
      '<button class="btn ghost" data-a="setup">ตั้งค่า</button></div>';
  }
  async function paintLib(){
    if (!ready()) return;
    let all = [];
    try { all = (await getSessions()) || []; } catch(e){ return; }
    all = all.filter(s => typeof ses === 'undefined' || !ses || s.id !== ses.id).sort((a, b) => b.id - a.id);
    const lis = $('lib').querySelectorAll('li');
    all.forEach((s, i) => {
      const li = lis[i], F = D.files[s.id];
      if (!li || !F) return;
      const div = li.querySelector('button > div');
      if (!div) return;
      let el = div.querySelector('.drvb');
      if (!el) { el = document.createElement('span'); div.appendChild(el); }
      const done = F.done || !D.video;
      el.className = 'drvb ' + (done ? 'ok' : 'warn');
      el.textContent = done ? 'อยู่บน Drive แล้ว' : 'Drive ' + pct(F, s.bytes) + '%';
    });
  }
  async function paintDetail(){
    if ($('detail').hidden || typeof cur === 'undefined' || !cur) { box.hidden = true; return; }
    box.hidden = false;
    const s = cur, F = D.files[s.id];
    if (!ready()) {
      box.innerHTML = '<div class="drv-h"><b>Google Drive</b><span class="drv-tag">ปิดอยู่</span></div>' +
        '<p>เปิดเก็บขึ้น Drive แล้ววิดีโอจะไม่หายแม้ลบออกจากแอป</p><div class="row"><button class="btn" data-a="setup">ตั้งค่า Google Drive</button></div>';
      return;
    }
    if (!F) {
      box.innerHTML = '<div class="drv-h"><b>Google Drive</b><span class="drv-tag">ยังไม่ได้ส่ง</span></div>' +
        '<p>โชว์นี้อัดก่อนเปิดเก็บขึ้น Drive ส่งขึ้นไปเก็บตอนนี้ได้ ' + fmtB(s.bytes || 0) + '</p>' +
        '<div class="row"><button class="btn solid" data-a="track">ส่งโชว์นี้ขึ้น Drive</button></div>';
      return;
    }
    const L = lay[s.id], total = (L && L.closed ? L.total : s.bytes) || 0, p = F.done ? 100 : pct(F, total);
    let tag, k, line;
    if (!D.video) { k = F.meta ? 'ok' : 'warn'; tag = F.meta ? 'เก็บรายชื่อเพลงแล้ว' : 'รอส่ง'; line = 'ตั้งไว้ว่าส่งแค่รายชื่อเพลงและมาร์ก ไม่ส่งวิดีโอ'; }
    else if (F.done) { k = 'ok'; tag = 'ครบแล้ว'; line = 'วิดีโอทั้งโชว์ ' + fmtB(total) + ' อยู่บน Drive แล้ว ลบออกจากแอปเพื่อคืนพื้นที่ได้ไม่ต้องกลัวหาย'; }
    else if (F.err === 'full') { k = 'bad'; tag = 'Drive เต็ม'; line = 'ส่งไปแล้ว ' + fmtB(F.sent) + ' จาก ' + fmtB(total); }
    else {
      const sl = stateLine();
      k = 'warn'; tag = sl[0] === 'ok' ? 'ส่งแล้ว ' + p + '%' : sl[1];
      line = 'ส่งไปแล้ว ' + fmtB(F.sent) + ' จาก ' + fmtB(total) + (sl[2] ? ' · ' + sl[2] : '') +
             '<br><span style="color:var(--amber)">ถ้าลบโชว์นี้ตอนนี้ บน Drive จะเหลือแค่ส่วนที่ส่งไปแล้ว</span>';
    }
    box.innerHTML = '<div class="drv-h"><b>Google Drive</b><span class="drv-tag ' + k + '">' + esc(tag) + '</span></div>' +
      (D.video ? '<div class="drv-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + p + '" aria-label="ส่งขึ้น Drive"><i style="width:' + p + '%"></i></div>' : '') +
      '<p>' + line + '</p><div class="row">' +
      (tokenOk(20) ? '' : '<button class="btn solid" data-a="auth">เชื่อมต่อ</button>') +
      (F.vid ? '<a class="btn" href="https://drive.google.com/file/d/' + encodeURIComponent(F.vid) + '/view" target="_blank" rel="noopener">เปิดใน Drive</a>'
             : D.folder ? '<a class="btn" href="https://drive.google.com/drive/folders/' + encodeURIComponent(D.folder) + '" target="_blank" rel="noopener">เปิดโฟลเดอร์</a>' : '') +
      '</div>';
  }
  let paintQ = false;
  function paint(){
    if (paintQ) return;
    paintQ = true;
    requestAnimationFrame(() => {
      paintQ = false;
      if (!$('home').hidden) { paintCard().catch(() => {}); paintLib().catch(() => {}); }
      if (!$('detail').hidden) paintDetail();
    });
  }

  /* ---------- หน้าตั้งค่า ---------- */
  const sheet = document.createElement('div');
  sheet.className = 'sheet'; sheet.id = 'drvSheet'; sheet.hidden = true;
  sheet.innerHTML = `
<div class="box" role="dialog" aria-modal="true" aria-labelledby="drvH">
  <div class="box-head"><h3 id="drvH">เก็บขึ้น Google Drive</h3><button class="btn solid" id="drvClose">เสร็จ</button></div>
  <div class="box-body">
    <p>วิดีโอส่งขึ้น Drive ของคุณเองตามไประหว่างอัด ไม่ผ่านเซิร์ฟเวอร์ของใคร แอปเห็นได้เฉพาะไฟล์ที่แอปสร้างในโฟลเดอร์ "อัดโชว์"</p>
    <div id="drvIdBox">
      <h4>ทำครั้งเดียว: สร้าง Client ID (ฟรี ไม่ต้องผูกบัตร ราว 5 นาที)</h4>
      <ol class="steps">
        <li>เปิด <b>console.cloud.google.com</b> ล็อกอินด้วย Gmail ที่จะเก็บวิดีโอ → สร้างโปรเจกต์ใหม่ ชื่ออะไรก็ได้</li>
        <li>เมนู <b>APIs &amp; Services → Library</b> ค้น <b>Google Drive API</b> → กด <b>Enable</b></li>
        <li>เมนู <b>Google Auth Platform</b> (หรือ OAuth consent screen) → Get started → ตั้งชื่อแอป เลือก <b>External</b>
            แล้วที่หัวข้อ <b>Audience → Test users</b> ใส่ Gmail ของตัวเอง</li>
        <li>หัวข้อ <b>Clients → Create client</b> → ชนิด <b>Web application</b> → ช่อง <b>Authorized JavaScript origins</b> ใส่
            <code id="drvOrigin"></code> → Create</li>
        <li>ก๊อบ <b>Client ID</b> (ลงท้ายด้วย .apps.googleusercontent.com) มาวางด้านล่าง</li>
      </ol>
      <label class="lbl" for="drvId" style="margin-bottom:4px">Client ID</label>
      <input type="text" id="drvId" autocomplete="off" spellcheck="false" placeholder="xxxx.apps.googleusercontent.com">
      <p class="hint" style="margin:6px 0 12px">เครื่องที่สองใช้ Client ID เดิมได้เลย ไม่ต้องสร้างใหม่</p>
    </div>
    <button class="btn solid" id="drvGo" style="width:100%">เชื่อมต่อ Google Drive</button>
    <p class="status" id="drvMsg" role="status" aria-live="polite" style="margin-top:8px"></p>
    <div id="drvOpts">
      <h4>ส่งอะไรบ้าง</h4>
      <label class="chk"><input type="checkbox" id="drvVideo"> ส่งวิดีโอด้วย (ปิด = ส่งแค่รายชื่อเพลงและมาร์ก)</label>
      <label class="chk"><input type="checkbox" id="drvWifi"> ไม่ส่งวิดีโอผ่านเน็ตมือถือ รอต่อ Wi-Fi</label>
      <label class="chk"><input type="checkbox" id="drvSet"> ซิงค์เซ็ตลิสต์ระหว่างเครื่อง</label>
      <p id="drvRate"></p>
      <button class="btn" id="drvOld" style="width:100%;margin-bottom:8px" hidden></button>
      <button class="btn danger" id="drvOff" style="width:100%">หยุดเก็บขึ้น Drive บนเครื่องนี้</button>
      <p class="hint">หยุดแล้วไฟล์ที่อยู่บน Drive ไม่หาย วิดีโอในแอปก็ยังอยู่</p>
    </div>
  </div>
</div>`;
  document.body.appendChild(sheet);
  const drvMsg = t => { $('drvMsg').textContent = t || ''; };
  async function fillSheet(){
    $('drvOrigin').textContent = location.origin;
    $('drvId').value = D.clientId || '';
    $('drvIdBox').hidden = !!(D.on && D.clientId && D.email);
    $('drvGo').textContent = D.on && tokenOk(20) ? 'เชื่อมต่ออยู่ ' + (D.email || '') : D.on ? 'เชื่อมต่ออีกครั้ง' : 'เชื่อมต่อ Google Drive';
    $('drvOpts').hidden = !D.on;
    $('drvVideo').checked = !!D.video; $('drvWifi').checked = !!D.wifiOnly; $('drvSet').checked = !!D.setSync;
    const bps = typeof bytesPerSec === 'function' ? bytesPerSec() : 1.3e6;
    $('drvRate').textContent = 'ค่าภาพตอนนี้ใช้เน็ตขาขึ้นราว ' + (bps * 8 / 1e6).toFixed(1) + ' Mbps และราว ' + (bps * 3600 / 1e9).toFixed(1) +
      ' GB ต่อชั่วโมง เน็ตช้ากว่านี้ก็อัดได้ปกติ แค่ส่งตามไม่ทัน แล้วส่งต่อหลังจบโชว์';
    let old = [];
    try { old = ((await getSessions()) || []).filter(s => !tracked(s)); } catch(e){}
    $('drvOld').hidden = !D.on || !old.length;
    $('drvOld').textContent = 'ส่งวิดีโอเก่าที่อยู่ในแอปขึ้นไปด้วย ' + old.length + ' โชว์';
    $('drvOld').onclick = () => { old.forEach(s => fileOf(s)); saveD(); list = null; fillSheet(); toast('เพิ่มเข้าคิวแล้ว'); nudge(); };
  }
  function openSheet(){
    loadGis().catch(() => {});
    drvMsg(''); fillSheet(); sheet.hidden = false;
  }
  function closeSheet(){ sheet.hidden = true; paint(); }
  $('drvClose').onclick = closeSheet;
  sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
  $('drvId').addEventListener('input', () => { loadGis().catch(() => {}); });
  $('drvGo').onclick = () => {
    const id = $('drvId').value.trim();
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(id)) { drvMsg('Client ID ไม่ถูกต้อง ต้องลงท้ายด้วย .apps.googleusercontent.com'); $('drvId').focus(); return; }
    if (id !== D.clientId) { D.clientId = id; D.folder = null; D.setFile = null; client = null; tok = null; LS.set('as_drive_tok', null); }
    saveD();
    drvMsg('กำลังเปิดหน้าล็อกอิน Google');
    signIn().then(async () => {
      if (!D.on) { D.on = true; D.since = D.since || Date.now(); }
      saveD();
      drvMsg('กำลังเตรียมโฟลเดอร์ "อัดโชว์" ใน Drive');
      try { await folder(); await refreshAbout(); drvMsg('เชื่อมต่อแล้ว โชว์ที่อัดจากนี้จะส่งขึ้น Drive เอง'); }
      catch (e) { drvMsg(/403|accessNotConfigured|disabled/i.test(e.message) ? 'ยังไม่ได้เปิด Google Drive API ในโปรเจกต์ (ขั้นที่ 2)' : e.message); }
      fillSheet(); nudge();
    }, e => drvMsg(e.message));
  };
  $('drvVideo').onchange = () => { D.video = $('drvVideo').checked; saveD(); nudge(); };
  $('drvWifi').onchange = () => { D.wifiOnly = $('drvWifi').checked; saveD(); nudge(); };
  $('drvSet').onchange = () => { D.setSync = $('drvSet').checked; if (D.setSync) D.setFile = null; saveD(); nudge(); };
  $('drvOff').onclick = () => {
    if (!confirm('หยุดเก็บขึ้น Drive บนเครื่องนี้?\nไฟล์บน Drive ไม่หาย วิดีโอในแอปก็ยังอยู่')) return;
    signOut(); D.on = false; D.files = {}; D.since = 0; saveD();
    fillSheet(); paint(); toast('หยุดแล้ว');
  };

  function onAction(e){
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'setup') openSheet();
    else if (a === 'auth') signIn().then(() => { toast('เชื่อมต่อ Drive แล้ว'); }, err => toast(err.message, 5000));
    else if (a === 'retry') { Object.values(D.files).forEach(F => { if (F.err === 'full') F.err = ''; }); saveD(); until = 0; backoff = 0; st.phase = 'idle'; nudge(); }
    else if (a === 'track' && cur) { fileOf(cur); saveD(); list = null; nudge(); paintDetail(); toast('เริ่มส่งขึ้น Drive แล้ว'); }
  }
  card.addEventListener('click', onAction);
  box.addEventListener('click', onAction);

  function afterSignIn(){
    st.phase = 'idle'; until = 0; backoff = 0;
    Promise.resolve().then(async () => {
      try { await folder(); if (!D.aboutAt || Date.now() - D.aboutAt > 600000 || !D.email) await refreshAbout(); } catch(e){}
      nudge(); paint();
    });
  }

  /* ปลุกตัวส่ง */
  window.addEventListener('online', () => { until = 0; backoff = 0; nudge(); paint(); });
  window.addEventListener('offline', () => paint());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { setPullAt = 0; nudge(); paint(); } });
  try { navigator.connection && navigator.connection.addEventListener('change', () => nudge()); } catch(e){}
  setInterval(() => { if (ready()) { nudge(); if (!$('detail').hidden || !$('home').hidden) paint(); } }, 3000);

  if (D.clientId && navigator.onLine) loadGis().catch(() => {});
  if (D.files) for (const k in D.files) { if (D.files[k].uri && !D.files[k].done) D.files[k].check = true; }
  paint();
  nudge();
  window.__drive = { D, st, nudge, tokenOk, lay, expire: () => { if (tok) { tok.exp = Date.now(); LS.set('as_drive_tok', tok); } } };   // ไว้ให้ชุดทดสอบใช้
})();
