/* ============================================================
   เสียงกลองจริงของ Klong Pro — ชุดเสียงที่อัดจากกลองจริง

   ไฟล์นี้แยกจากตัวโปรแกรมโดยตั้งใจเหมือน theme/
   index.html มีแค่บรรทัดที่เรียกไฟล์นี้ กับทางเข้าหนึ่งบรรทัดใน playVoice()
     if(window.KlongSounds && window.KlongSounds.play(S.ctx, dSink, key, when, vel, out)) return;
   ถ้า play() คืน false (เลือกเสียงสังเคราะห์ · ชุดยังโหลดไม่เสร็จ · ไม่มีเสียงอัดของท่านั้น)
   โปรแกรมจะเล่นชุดสังเคราะห์ในเครื่อง (KIT ใน index.html) ต่อ และถ้ายังไม่พร้อมอีก
   ใช้เสียงสังเคราะห์แบบเดิม ไม่มีวันเงียบ

   ทำอะไรบ้าง
   1) โหลดเฉพาะชุดที่เลือก (ไม่โหลดทุกชุด) แล้วถอดรหัสไว้ล่วงหน้า — ชิ้นจากชุดอื่นที่ผู้ใช้เลือกมาใส่แทน โหลดเฉพาะชิ้นนั้น
      ไฟล์ถูก Service Worker เก็บไว้ในเครื่องถาวร โหลดครั้งเดียวใช้ออฟไลน์ได้
   2) น้ำหนักการตีเลือกชั้นเสียง: เบา (โกสต์) / ปกติ / เน้น — ตรงกับเกณฑ์ของโปรแกรม
      ghostOf() = vel < 55, accentOf() = vel >= 110 แล้วไล่ความดังละเอียดในชั้นตาม vel
   3) สุ่มไฟล์ในชั้นเดียวกันโดยไม่ซ้ำกับครั้งก่อน ตีรัวแล้วไม่ดังเหมือนเครื่อง
   4) ไฮแฮตเปิดถูกตัดเมื่อเหยียบหรือตีไฮแฮตปิดตามมา เหมือนไฮแฮตจริง
      กลองใบเดียวกันตีซ้ำ เสียงเก่าหรี่ลงเร็ว ๆ (หนังกลองถูกตีใหม่) ฉาบปล่อยให้ดังซ้อนได้
   5) วางตำแหน่งซ้าย-ขวาแบบมุมมองคนตี (ชุดโมโน) ชุดอะคูสติกเป็นสเตอริโอจากไมค์จริงอยู่แล้ว
   6) ชดเชยช่วงเงียบหัวไฟล์ MP3 (encoder delay ~25 ms) ที่เบราว์เซอร์บางตัวไม่ตัดให้
      ไม่งั้นเสียงกลองจะช้ากว่าโน้ตบนกริดและเพลงจริง ซึ่งแย่มากสำหรับงานแกะเพลง
   7) ครอสสติ๊กและริมช็อตเป็นเสียงอัดจริง (ชิ้นเสริม XS/RS — เดิมครอสสติ๊กเป็นเสียงสังเคราะห์ ริมช็อตเป็นสแนร์ตีแรง)
   8) ปรับแต่งรายใบ (sounds/klong-kitfx.js): จูน · หัว/หางเสียง · โค้งน้ำหนัก · เปลี่ยนแหล่งเสียง ทำที่นี่ทีละการตี
      ส่วน EQ/คอมเพรสเซอร์/แซต/ระดับ/ห้อง เป็นสายเสียงของใบนั้น (out) ที่ playVoice ส่งมาให้

   ที่มาของเสียงและสัญญาอนุญาต: sounds/LICENSES.txt
   ============================================================ */
(function(){
"use strict";
var KEY="klong-kit";
var me=document.currentScript;
var BASE=new URL("./", (me && me.src) || location.href).href;      // .../sounds/

/* ชุดที่เลือกได้ เรียงตามที่แสดงในแผงตั้งค่า
   trim = ระดับรวมของชุด เทียบให้ดังพอ ๆ กับเสียงสังเคราะห์เดิม (+2 dB) แถบ "กลอง" จะได้ไม่ต้องปรับใหม่
   วัดจากปุ่มทดสอบเสียง (กระเดื่อง+ไฮแฮต แล้วสแนร์) ค่า RMS ตอนแถบกลองต่ำจนคอมเพรสเซอร์ไม่ทำงาน
   ชุดดิบดังกว่าเสียงสังเคราะห์ 11.7-14.3 dB และต่างกันเองตามชุด
   cross / rim = ชดเชยความดังของครอสสติ๊ก/ริมช็อต (ชิ้นเสริมใช้ร่วมทุกชุด) ให้ห่างจากสแนร์ของชุดนั้นเท่ากันทุกชุด
   วัดในเบราว์เซอร์ (RMS 60 ms แรก เฉลี่ยหลายการตี ผ่าน play() จริง): ครอสสติ๊ก vel 100 = สแนร์ vel 100 −6 dB
   ริมช็อต vel 100 = สแนร์ vel 118 +2 dB — ชุดทดสอบ (iPad-แต่งเสียงกลอง) วัดซ้ำทุกชุด คลาดเกิน 1.5 dB ฟ้อง */
var KITS=[
  {id:"acoustic", th:"อะคูสติก", note:"กลองจริงสเตอริโอ ละเอียดที่สุด", trim:0.327, cross:-1.9, rim:-2.4,
   credit:"Salamander Drumkit by Alexander Holm (CC BY-SA 3.0)"},
  {id:"rock",     th:"ร็อก",     note:"หนัก หนา ห้องใหญ่", trim:0.244, cross:0.7, rim:-0.5},
  {id:"pop",      th:"ป๊อป",     note:"สะอาด กระชับ", trim:0.275, cross:1.0, rim:-1.2},
  {id:"jazz",     th:"แจ๊ส",     note:"เบา โปร่ง ฉาบใส", trim:0.244, cross:0.3, rim:1.1},
  {id:"hiphop",   th:"ฮิปฮอป",   note:"โลไฟ ทอมแบบ 808", trim:0.280, cross:-3.1, rim:-3.8},
  {id:"synth",    th:"สังเคราะห์", note:"สร้างเสียงในเครื่อง (ชุด KIT) ไม่ต้องโหลด"}
];
var DEFAULT="acoustic";

/* เสียงของโปรแกรม (instrument:articulation) → ชิ้นในชุดเสียง
   add:true = ใช้จากชิ้นเสริม (ชุดหลักไม่มี) · pan = ซ้าย(-)/ขวา(+) มุมคนตี
   kind: drum = ตีซ้ำแล้วเสียงเก่าหรี่ · hat = ไฮแฮต (เปิดถูกตัด) · cym = ฉาบ ดังซ้อนได้
   kdb = ชื่อค่าชดเชยรายชุดใน KITS */
var MAP={
  "kick":       {c:"BD",    pan: 0.00, kind:"drum"},
  "snare":      {c:"SN",    pan:-0.05, kind:"drum"},
  /* ริมช็อต/ครอสสติ๊ก: เสียงอัดจริงจาก Freesound (CC0) — ผู้ใช้บอกว่าครอสสติ๊กสังเคราะห์ไม่ตรงเสียงจริง
     แหล่งอื่นเลือกได้ในหน้าแต่งเสียงกลอง (ริมช็อตแบบเดิม = สแนร์ของชุดตีแรง · ครอสสติ๊กแบบเดิม = สังเคราะห์) */
  "snare:rim":  {c:"RS",    pan:-0.05, kind:"drum", add:true, kdb:"rim"},
  "snare:cross":{c:"XS",    pan:-0.05, kind:"drum", add:true, kdb:"cross"},
  "hihat":      {c:"HH",    pan:-0.32, kind:"hat"},
  "hihat:open": {c:"HO",    pan:-0.32, kind:"hat", open:true},
  "hhf":        {c:"HF",    pan:-0.28, kind:"hat"},
  "tom1":       {c:"T1",    pan:-0.14, kind:"drum"},
  "tom2":       {c:"T2",    pan: 0.10, kind:"drum"},
  "floor":      {c:"FT",    pan: 0.30, kind:"drum"},
  "crash":      {c:"CR",    pan:-0.38, kind:"cym"},
  "crash2":     {c:"C2",    pan: 0.42, kind:"cym"},
  "ride":       {c:"RD",    pan: 0.36, kind:"cym"},
  "bell":       {c:"RB_20", pan: 0.36, kind:"cym", add:true},
  "china":      {c:"CH_18", pan: 0.48, kind:"cym", add:true},
  "splash":     {c:"SP_10", pan:-0.22, kind:"cym", add:true},
  "cow":        {c:"CB",    pan: 0.12, kind:"drum", add:true}
};
/* แหล่งเสียงที่ใส่แทนได้ต่อเสียงของโปรแกรม (หน้าแต่งเสียงกลอง)
   "" = ตามชุด · "kit:<ชุด>" = ชิ้นเดียวกันจากชุดอื่น · "add:<รหัส>" = ชิ้นเสริมขนาดอื่น
   "snare" = สแนร์ (ของแหล่งที่ใช้อยู่) ตีแรง — แบบเดิมของริมช็อต · "synth" = เสียงสังเคราะห์ (ชุด KIT) */
var TOMS=["T_8","T_10","T_12","T_13","T_14","F_16","F_18"];
var ALT={
  "kick":["kits"], "snare":["kits","add:SN2_13"],
  "snare:rim":["add:RS","add:RS2","snare","synth"], "snare:cross":["add:XS","add:XS2","synth"],
  "hihat":["kits","add:XH_14"], "hihat:open":["kits"], "hhf":["kits"],
  "tom1":["kits"].concat(TOMS.map(function(c){ return "add:"+c; })),
  "tom2":["kits"].concat(TOMS.map(function(c){ return "add:"+c; })),
  "floor":["kits"].concat(TOMS.map(function(c){ return "add:"+c; })),
  "crash":["kits","add:C_16","add:C_17","add:C_19"], "crash2":["kits","add:C_16","add:C_17","add:C_19"],
  "ride":["kits","add:RD_20","add:RD_22"], "bell":["add:RB_20"],
  "china":["add:CH_18","add:ST"], "splash":["add:SP_10","add:C_16"], "cow":["add:CB"]
};
/* ค่ากลางของ vel ในแต่ละชั้น (ตรงกับ DYN_VEL ของโปรแกรม) ใช้ไล่ความดังละเอียดในชั้น */
var NOM={ghost:42, normal:100, accent:118};

var kit=DEFAULT;
try{ var sv=localStorage.getItem(KEY); if(sv && KITS.some(function(k){ return k.id===sv; })) kit=sv; }catch(e){}

var meta=null, metaP=null;            // kits.json
var slots={};                         // "ชุด|รหัส" → {st:"load"|"ok"|"fail", gain, layers:{ghost:[{buf,off}],...}, p}
var bank={};                          // kitId → {ready, loaded, total, failed, error} ความคืบหน้าของชุดหลัก
var loads={};                         // kitId → Promise
var listeners=[];
var stats={played:0, fallback:0};
var lastPick={};                      // "ชุด|รหัส|ชั้น" → ดัชนีล่าสุด (สุ่มไม่ซ้ำ)
var active=[];                        // เสียงที่ยังดังอยู่
var lastCtx=null;
function FX(){ return window.KlongFX || null; }

function emit(){ for(var i=0;i<listeners.length;i++){ try{ listeners[i](state()); }catch(e){} } }
function state(){
  var b=bank[kit];
  return {kit:kit, synth:kit==="synth", ready:kit==="synth" || !!(b && b.ready),
          loaded:b?b.loaded:0, total:b?b.total:0, failed:b?b.failed:0, error:b?b.error:""};
}
function dbGain(db){ return Math.pow(10, db/20); }
function kitInfo(id){ for(var i=0;i<KITS.length;i++) if(KITS[i].id===id) return KITS[i]; return null; }
function kitTrim(id){ var k=kitInfo(id); return (k && k.trim) || 1; }

function getMeta(){
  if(meta) return Promise.resolve(meta);
  if(!metaP) metaP=fetch(BASE+"kits.json").then(function(r){
    if(!r.ok) throw new Error("kits.json "+r.status);
    return r.json();
  }).then(function(j){ meta=j; return j; }, function(e){ metaP=null; throw e; });
  return metaP;
}
function instOf(kitId, code){
  if(!meta) return null;
  for(var i=0;i<meta.kits.length;i++){
    var k=meta.kits[i]; if(k.id!==kitId) continue;
    for(var j=0;j<k.instruments.length;j++) if(k.instruments[j].code===code) return k.instruments[j];
  }
  return null;
}

/* ถอดรหัสด้วย OfflineAudioContext — ไม่ต้องรอผู้ใช้แตะจอ (AudioContext จริงต้องรอ)
   บัฟเฟอร์ที่ได้ใช้กับ AudioContext ไหนก็ได้ เบราว์เซอร์ปรับอัตราสุ่มให้เองถ้าไม่ตรง */
var decoder=null;
function decode(ab){
  if(!decoder){
    var OAC=window.OfflineAudioContext||window.webkitOfflineAudioContext;
    decoder=new OAC(1, 1, 44100);
  }
  return new Promise(function(ok, bad){
    try{
      var p=decoder.decodeAudioData(ab, ok, bad);
      if(p && p.catch) p.catch(bad);
    }catch(e){ bad(e); }
  });
}
/* หาจุดเริ่มเสียงจริง: ไฟล์ตัดหัวไว้แล้ว ที่เหลือคือช่วงเงียบของตัวเข้ารหัส MP3
   ข้ามไปจุดแรกที่ดังเกิน 2% ของยอดเสียง ถอยไว้ 1 ms กันหัวเสียงหาย */
/* ความดังของไฟล์ (RMS 60 ms แรกหลังจุดเริ่ม, dB) — ใช้กับ "ช่วงไดนามิก" รายใบ: ไฟล์ตีเบาอัดมาเบากว่าอยู่แล้ว
   ช่วงไดนามิก 0% ต้องดังเท่ากันจริง จึงต้องรู้ว่าแต่ละไฟล์ต่างจากชั้นปกติเท่าไร */
function loudOf(buf, off){
  var sr=buf.sampleRate, a=Math.round(off*sr), n=Math.min(buf.length-a, Math.round(sr*0.06)), e=0, ch=buf.numberOfChannels;
  for(var c=0;c<ch;c++){ var d=buf.getChannelData(c); for(var i=0;i<n;i++){ var v=d[a+i]; e+=v*v; } }
  return 10*Math.log10(e/Math.max(1, n*ch)+1e-12);
}
function onsetOf(buf){
  var sr=buf.sampleRate, n=Math.min(buf.length, Math.round(sr*0.4)), ch=buf.numberOfChannels;
  var peak=0, i, c, d, a;
  for(c=0;c<ch;c++){ d=buf.getChannelData(c); for(i=0;i<n;i++){ a=d[i]<0?-d[i]:d[i]; if(a>peak) peak=a; } }
  if(!peak) return 0;
  var thr=peak*0.02, first=n;
  for(c=0;c<ch;c++){ d=buf.getChannelData(c); for(i=0;i<first;i++){ if((d[i]<0?-d[i]:d[i])>=thr){ first=i; break; } } }
  var off=Math.max(0, first-Math.round(sr*0.001))/sr;
  return off>0.08 ? 0 : off;
}

/* ดึงไฟล์เสียง ปกติ Service Worker เก็บลงแคชถาวรให้เอง (sw.js ส่วน SOUNDS)
   แต่ตอนเปิดครั้งแรกสุด Service Worker ยังไม่ได้คุมหน้า ไฟล์ที่โหลดตอนนั้นจะไม่ถูกเก็บ
   ออฟไลน์ครั้งหน้าจะไม่มีเสียงจริง จึงเก็บเองลงแคชชื่อเดียวกัน */
var SAMPLE_CACHE="drum-samples-v1";          // ต้องตรงกับ SOUNDS ใน sw.js
function okBuf(r){ if(!r.ok) throw new Error(r.status); return r.arrayBuffer(); }
function getFile(url){
  var ctl=navigator.serviceWorker && navigator.serviceWorker.controller;
  if(ctl || !window.caches) return fetch(url).then(okBuf);
  return caches.open(SAMPLE_CACHE).then(function(c){
    return c.match(url).then(function(hit){
      if(hit) return hit.arrayBuffer();
      return fetch(url).then(function(r){
        if(!r.ok) throw new Error(r.status);
        c.put(url, r.clone()).catch(function(){});
        return r.arrayBuffer();
      });
    });
  }, function(){ return fetch(url).then(okBuf); });
}

/* โหลดชิ้นเดียว (ชุด|รหัส) — ใช้ซ้ำทั้งตอนโหลดชุดหลักและตอนผู้ใช้เลือกชิ้นจากชุดอื่นมาใส่แทน
   ไฟล์ละงาน ทำพร้อมกันไม่เกิน 6 งานทั้งระบบ */
var queue=[], running=0;
function runQueue(){
  while(running<6 && queue.length){
    var job=queue.shift(); running++;
    (function(job){
      getFile(job.url).then(decode).then(function(buf){ var off=onsetOf(buf); job.into.push({buf:buf, off:off, db:loudOf(buf, off)}); job.done(true); },
        function(){ job.done(false); }).then(function(){ running--; runQueue(); });
    })(job);
  }
}
function loadSlot(kitId, code, onFile){
  var id=kitId+"|"+code, s=slots[id];
  if(s && s.st!=="fail") return s.p;
  s=slots[id]={st:"load", gain:1, layers:{}, failed:0, n:0};
  s.p=getMeta().then(function(){
    var ins=instOf(kitId, code);
    if(!ins){ s.st="fail"; return null; }
    s.gain=ins.playGain||1;
    var files=[];
    Object.keys(ins.layers).forEach(function(L){ s.layers[L]=[]; ins.layers[L].forEach(function(f){ files.push([L, BASE+ins.folder+"/"+f]); }); });
    s.n=files.length;
    return new Promise(function(ok){
      var left=files.length; if(!left){ s.st="fail"; ok(null); return; }
      files.forEach(function(f){
        queue.push({url:f[1], into:s.layers[f[0]], done:function(good){
          if(!good) s.failed++;
          if(onFile) onFile(good);
          if(--left===0){
            s.st = s.failed<s.n ? "ok" : "fail";
            var nl=s.layers.normal && s.layers.normal.length ? s.layers.normal : (s.layers.accent||s.layers.ghost||[]);   // ความดังอ้างอิง = เฉลี่ยชั้นปกติ
            if(nl.length){ var t=0; nl.forEach(function(x){ t+=x.db; }); s.ref=t/nl.length; }
            ok(s.st==="ok" ? s : null);
          }
        }});
      });
      runQueue();
    });
  }, function(){ s.st="fail"; return null; });
  return s.p;
}
function slotReady(kitId, code){ var s=slots[kitId+"|"+code]; return s && s.st==="ok" ? s : null; }

function codesFor(){
  var main={}, add={};
  for(var k in MAP){ if(MAP[k].add) add[MAP[k].c]=1; else main[MAP[k].c]=1; }
  return {main:Object.keys(main), add:Object.keys(add)};
}
function loadKit(id){
  if(id==="synth") return Promise.resolve();
  if(loads[id]) return loads[id];
  var b=bank[id]={ready:false, loaded:0, total:0, failed:0, error:""};
  emit();
  loads[id]=getMeta().then(function(){
    var want=codesFor(), list=[];
    want.main.forEach(function(c){ list.push([id, c]); });
    want.add.forEach(function(c){ list.push(["addons", c]); });
    list.forEach(function(x){ var ins=instOf(x[0], x[1]); if(ins) Object.keys(ins.layers).forEach(function(L){ b.total+=ins.layers[L].length; }); });
    emit();
    return Promise.all(list.map(function(x){
      return loadSlot(x[0], x[1], function(good){ b.loaded++; if(!good) b.failed++; if(b.loaded%6===0 || b.loaded===b.total) emit(); });
    }));
  }).then(function(){
    b.ready = b.loaded>0 && b.failed < b.total;
    if(!b.ready) b.error="โหลดไม่ได้";
    if(!b.ready) delete loads[id];          // ให้ลองใหม่ได้ เช่น ต่อเน็ตแล้ว
    emit();
    if(b.ready && FX() && FX().warm) FX().warm(id);   // ชิ้นที่ผู้ใช้เปลี่ยนแหล่งไว้ + เสียงที่จูนไว้ เตรียมต่อเลย
  }, function(e){
    b.error="โหลดไม่ได้"; delete loads[id]; emit();
  });
  return loads[id];
}

/* แหล่งเสียงจริงของเสียงนี้ในชุดนี้ (รวมที่ผู้ใช้เลือกแทน) → {k:ชุด, c:รหัส, min, db} หรือ {synth:true}
   own = แหล่งตามชุด (ใช้ตอนแหล่งที่เลือกยังโหลดไม่เสร็จ) */
function resolve(kitId, key, m, src){
  var own = m.add ? {k:"addons", c:m.c} : {k:kitId, c:m.c};
  if(!src) return own;
  if(src==="synth") return {synth:true};
  if(src==="snare"){
    var sn=FX() ? FX().voice(kitId, "snare").src : "";
    var r=resolve(kitId, "snare", MAP.snare, sn==="snare" ? "" : sn);
    return {k:r.k, c:r.c, min:"normal", db:2.5, kitTrim:true};
  }
  if(src.indexOf("kit:")===0){ var kk=src.slice(4); return kitInfo(kk) && kk!=="synth" && !m.add ? {k:kk, c:m.c, other:kk!==kitId} : own; }
  if(src.indexOf("add:")===0) return {k:"addons", c:src.slice(4)};
  return own;
}
/* ชิ้นที่ต้องโหลดเพิ่มตามที่ผู้ใช้เลือกแหล่งเสียงไว้ (หน้าแต่งเสียงเรียกตอนเปลี่ยน/ตอนส่งออกวิดีโอ) */
function prepare(kitId){
  kitId=kitId||kit;
  if(kitId==="synth" || !FX()) return Promise.resolve();
  var jobs=[];
  for(var key in MAP){
    var r=resolve(kitId, key, MAP[key], FX().voice(kitId, key).src);
    if(!r.synth) jobs.push(loadSlot(r.k, r.c));
  }
  return Promise.all(jobs);
}

/* เลือกชั้นตามน้ำหนัก ชั้นที่ไม่มีไฟล์ถอยไปชั้นข้างเคียง */
function layerOf(vel, min){
  var L = vel<55 ? "ghost" : (vel>=110 ? "accent" : "normal");
  if(min==="normal" && L==="ghost") L="normal";
  return L;
}
function pick(slot, L, keyBase){
  var order = L==="ghost" ? ["ghost","normal","accent"] : L==="accent" ? ["accent","normal","ghost"] : ["normal","accent","ghost"];
  for(var i=0;i<order.length;i++){
    var arr=slot.layers[order[i]];
    if(arr && arr.length){
      var k=keyBase+"|"+order[i], last=lastPick[k], j;
      if(arr.length===1) j=0;
      else { j=Math.floor(Math.random()*(arr.length-1)); if(last!=null && j>=last) j++; }
      lastPick[k]=j;
      return {s:arr[j], layer:order[i], single:arr.length===1};
    }
  }
  return null;
}

/* หรี่เสียงที่ดังค้าง ณ เวลา at — เสียงที่มีหัว/หางเสียง (ปรับแต่งรายใบ) คิดระดับจริง ณ เวลานั้นก่อน ไม่ให้กระโดด */
function damp(v, at, tau){
  if(v.damped) return;
  v.damped=true;
  var t=Math.max(at, v.t), p=v.g.gain;
  try{
    if(v.env){
      if(p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t);
      else { p.cancelScheduledValues(t); p.setValueAtTime(v.env(t), t); }
    } else p.setValueAtTime(v.gain, t);
    p.setTargetAtTime(0, t, tau);
    v.src.stop(t+tau*8);
  }catch(e){}
}

function play(ctx, sink, key, when, vel, out){
  if(kit==="synth" || !ctx || !sink) return false;
  var b=bank[kit];
  if(!b || !b.ready){ stats.fallback++; return false; }
  var m=MAP[key];
  if(!m){ m=MAP[String(key).split(":")[0]]; if(!m) return false; }   // ท่าอื่นที่ไม่มีไฟล์แยก → เสียงตัวกลองนั้น
  var fx=FX() ? FX().voice(kit, key) : null;
  var r=resolve(kit, MAP[key] ? key : String(key).split(":")[0], m, fx && fx.src);
  if(r.synth) return false;                                   // ผู้ใช้เลือกเสียงสังเคราะห์ (เช่น ครอสสติ๊กแบบเดิม)
  var slot=slotReady(r.k, r.c);
  if(!slot){
    loadSlot(r.k, r.c);                                       // แหล่งที่เลือกยังไม่มา: เริ่มโหลด แล้วใช้แหล่งตามชุดไปก่อน
    r=resolve(kit, key, m, ""); slot=slotReady(r.k, r.c);
    if(!slot){ stats.fallback++; return false; }
  }
  vel = vel==null ? 100 : vel;
  if(fx) vel=FX().curve(vel, fx);                             // โค้งน้ำหนักรายใบ (มีผลกับการเลือกชั้นด้วย เหมือนโมดูลกลองไฟฟ้า)
  var L=layerOf(vel, r.min || m.min);
  var p=pick(slot, L, r.k+"|"+r.c);
  if(!p){ stats.fallback++; return false; }
  var f=vel/NOM[p.layer]; f = f<0.45 ? 0.45 : (f>1.2 ? 1.2 : f);
  var lv=(meta && meta.strokeLevelDb_app_default) || {ghost:-8, normal:0, accent:2};
  var layerDb = fx ? (p.layer==="ghost" ? fx.ghost : p.layer==="accent" ? fx.accent : 0) : (lv[p.layer] || 0);
  var velDb = layerDb + 20*Math.log10(f);
  if(fx && fx.dyn!==1){
    /* ช่วงไดนามิก: 0 = ทุกการตีดังเท่ากัน · 1 = ปกติ · 1.5 = ห่างขึ้น
       ความดังที่ได้ยิน = ความดังของไฟล์ (เทียบชั้นปกติ) + ระดับชั้น + ไล่ในชั้น → คูณทั้งก้อนด้วย dyn */
    var inh=(p.s.db!=null && slot.ref!=null) ? p.s.db-slot.ref : 0;
    velDb = fx.dyn*velDb + (fx.dyn-1)*inh;
  }
  var ki=kitInfo(kit) || {};
  var kdb = m.kdb && !r.kitTrim ? (ki[m.kdb]||0) : 0;
  var gain=kitTrim(kit) * slot.gain * dbGain(velDb + (r.db||0) + kdb + (fx ? fx.artDb : 0));

  lastCtx=ctx;
  /* จูน: ใช้บัฟเฟอร์ที่สุ่มอัตราใหม่แบบคุณภาพสูง (windowed-sinc) ถ้าพร้อมแล้ว ไม่งั้นใช้ playbackRate ไปก่อน (ได้ยินทันที) */
  var cents = fx ? fx.cents : 0, rate=Math.pow(2, cents/1200);
  var buf=p.s.buf, off=p.s.off, prate=1;
  if(cents){
    var hq=FX().tuned(buf, cents);
    if(hq){ buf=hq; off=p.s.off/rate; } else prate=rate;
  }
  if(p.single) prate*=Math.pow(2, (Math.random()-0.5)*8/1200);    // ไฟล์เดียวในชั้น: ต่างกัน ±4 เซนต์ ไม่ดังเหมือนเครื่อง
  var src=ctx.createBufferSource(); src.buffer=buf;
  if(prate!==1) src.playbackRate.value=prate;
  var g=ctx.createGain();
  var dst=out||sink, o=g, pan=null;
  var userPan = fx && fx.pan!=null ? fx.pan : null;
  if(ctx.createStereoPanner && (buf.numberOfChannels===1 ? (userPan!=null ? true : !!m.pan) : userPan!=null)){
    pan=ctx.createStereoPanner(); pan.pan.value = userPan!=null ? userPan : m.pan;
    if(buf.numberOfChannels===1) gain*=Math.SQRT2;            // ตัวแพนหรี่กลางลง 3 dB ชดเชยให้ดังเท่าไม่แพน
    g.connect(pan); o=pan;
  }
  src.connect(g); o.connect(dst);
  var dur=(buf.duration-off)/prate;
  var env = fx ? FX().env(g.gain, when, gain, dur, fx) : null;
  if(!env) g.gain.value=gain;

  /* จัดการเสียงที่ยังดังค้าง ก่อนเริ่มเสียงใหม่ */
  var now=ctx.currentTime, keep=[];
  for(var i=0;i<active.length;i++){
    var v=active[i];
    if(v.end<now || v.sink!==sink || v.damped && v.t+0.3<now) continue;   // จบแล้ว หรือเป็นของรอบเล่นเก่า
    if(m.kind==="hat" && v.open && !v.damped) damp(v, when, 0.012);       // ไฮแฮตเปิดถูกปิด
    else if(m.kind==="drum" && v.c===r.c && !v.damped) damp(v, when, 0.045);   // หนังกลองถูกตีใหม่
    keep.push(v);
  }
  /* ฉาบใบเดียวกันดังซ้อนได้ แต่ไม่เกิน 5 เสียง และรวมทั้งชุดไม่เกิน 40 เสียง (กันเกินโควตาบน iPad) */
  var same=0;
  for(i=keep.length-1;i>=0;i--){ if(keep[i].c===r.c && !keep[i].damped && ++same>=5) damp(keep[i], when, 0.08); }
  if(keep.length>=40){ for(i=0;i<keep.length-39;i++) damp(keep[i], when, 0.05); }

  src.start(when, off);
  if(env && env.stop) src.stop(env.stop);
  keep.push({src:src, g:g, gain:gain, env:env && env.at, t:when, end:when+dur+0.05,
             c:r.c, open:!!m.open, sink:sink, damped:false});
  active=keep;
  stats.played++;
  if(FX() && FX().hit) FX().hit(key, when, vel, ctx);
  return true;
}

function setKit(id){
  if(!KITS.some(function(k){ return k.id===id; })) return;
  kit=id;
  try{ localStorage.setItem(KEY, id); }catch(e){}
  emit();
  return loadKit(id);
}

/* ชื่อแหล่งเสียงที่เลือกแทนได้ของเสียงนี้ (หน้าแต่งเสียงกลอง) → [{id, th}] */
function sources(key){
  var m=MAP[key], own=m && m.add ? instOf("addons", m.c) : null;
  var list=[{id:"", th: own ? own.name_th+" (เริ่มต้น)" : "ตามชุดที่เลือก"}], alt=ALT[key]||[];
  alt.forEach(function(a){
    if(a==="kits") KITS.forEach(function(k){ if(k.id!=="synth" && k.id!==kit) list.push({id:"kit:"+k.id, th:"ชุด"+k.th}); });
    else if(a==="snare") list.push({id:"snare", th:"สแนร์ของชุดตีแรง (แบบเดิม)"});
    else if(a==="synth") list.push({id:"synth", th:"เสียงสังเคราะห์ (แบบเดิม)"});
    else if(a.indexOf("add:")===0){
      var ins=instOf("addons", a.slice(4));
      if(MAP[key] && MAP[key].add && MAP[key].c===a.slice(4)) return;          // ซ้ำกับแหล่งตามชุด
      list.push({id:a, th: ins ? ins.name_th : a.slice(4)});
    }
  });
  return list;
}
/* บัฟเฟอร์ตัวอย่างของเสียงนี้ (ใช้วาดรูปคลื่นในหน้าแต่งเสียง) → {buf, off} หรือ null */
function sample(key, vel){
  if(kit==="synth") return null;
  var m=MAP[key] || MAP[String(key).split(":")[0]]; if(!m) return null;
  var fx=FX() ? FX().voice(kit, key) : null, r=resolve(kit, key, m, fx && fx.src);
  if(r.synth) return null;
  var s=slotReady(r.k, r.c) || (function(){ var o=resolve(kit, key, m, ""); return slotReady(o.k, o.c); })();
  if(!s) return null;
  var L=layerOf(vel==null ? 100 : vel, r.min||m.min), arr=s.layers[L] && s.layers[L].length ? s.layers[L] : (s.layers.normal||[]);
  return arr[0] || null;
}
/* บัฟเฟอร์ทุกไฟล์ของเสียงนี้ตามแหล่งที่ใช้อยู่ (ให้ตัวจูนเตรียมล่วงหน้า) */
function buffers(kitId, key){
  var m=MAP[key]; if(!m) return [];
  var fx=FX() ? FX().voice(kitId, key) : null, r=resolve(kitId, key, m, fx && fx.src);
  if(r.synth) return [];
  var s=slotReady(r.k, r.c), out=[];
  if(s) Object.keys(s.layers).forEach(function(L){ s.layers[L].forEach(function(x){ out.push(x.buf); }); });
  return out;
}

/* ---------- ตัวเลือกชุดเสียงในแผงตั้งค่า ส่วน "การฟัง" ---------- */
function injectUI(){
  var test=document.getElementById("testSnd");
  var sec=test && test.closest(".isec");
  if(!sec || document.getElementById("kKit")) return;
  var st=document.createElement("style");
  st.textContent=
    ".kkit{display:flex;flex-direction:column;gap:6px;margin-top:4px}"+
    ".kkit-h{font-size:12px;color:var(--dim)}"+
    "#kKit{flex-wrap:wrap}"+
    ".kkit-st{font-size:12px;color:var(--dim);line-height:1.45;min-height:1.45em}"+
    ".kkit-st.err{color:var(--warn)}"+
    ".kkit-cr{font-size:11px;color:var(--dimmer);line-height:1.4}"+
    "@media (pointer:coarse){#kKit button{min-height:44px}}";      // เป้านิ้วขั้นต่ำ 44px
  document.head.appendChild(st);
  var w=document.createElement("div"); w.className="kkit";
  var h='<div class="kkit-h" id="kKitH">ชุดเสียงกลอง</div><div class="seg" id="kKit" role="group" aria-labelledby="kKitH">';
  KITS.forEach(function(k){ h+='<button type="button" data-kit="'+k.id+'" aria-pressed="false">'+k.th+'</button>'; });
  h+='</div><div class="kkit-st" id="kKitSt" aria-live="polite"></div><div class="kkit-cr" id="kKitCr"></div>';
  w.innerHTML=h;
  sec.appendChild(w);
  var seg=w.querySelector("#kKit"), stEl=w.querySelector("#kKitSt"), cr=w.querySelector("#kKitCr");
  var wantPreview=false;
  function info(id){ return kitInfo(id) || KITS[0]; }
  function render(s){
    var bs=seg.querySelectorAll("button");
    for(var i=0;i<bs.length;i++) bs[i].setAttribute("aria-pressed", String(bs[i].dataset.kit===s.kit));
    var k=info(s.kit), t, err=false;
    if(s.synth) t=k.note;
    else if(s.ready) t=k.note+" · พร้อม ใช้ออฟไลน์ได้";
    else if(s.error){ t="โหลดเสียงชุดนี้ไม่ได้ (ไม่มีเน็ต?) — ใช้เสียงสังเคราะห์ไปก่อน แตะชื่อชุดอีกครั้งเพื่อลองใหม่"; err=true; }
    else t="กำลังโหลดเสียง "+s.loaded+"/"+(s.total||"…")+" — ระหว่างนี้ใช้เสียงสังเคราะห์";
    stEl.textContent=t; stEl.classList.toggle("err", err);
    cr.textContent=k.credit ? "เสียงชุดนี้: "+k.credit : "";
    if(wantPreview && s.ready){ wantPreview=false; preview(); }
  }
  function preview(){
    var play=document.getElementById("play");
    if(play && /พัก/.test(play.textContent)) return;              // กำลังเล่นเพลงอยู่ ไม่ตีทับ
    if(!lastCtx || lastCtx.state!=="running") return;               // ยังไม่เคยเปิดเสียง ไม่บังคับเปิด
    var t=document.getElementById("testSnd"); if(t) t.click();
  }
  seg.addEventListener("click", function(e){
    var b=e.target.closest("button[data-kit]"); if(!b) return;
    wantPreview=true;
    setKit(b.dataset.kit);
  });
  listeners.push(render);
  render(state());
}

function ready(){
  injectUI();
  if(kit!=="synth") setTimeout(function(){ loadKit(kit); }, 400);
}
if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", ready);
else ready();

window.KlongSounds={
  play:play, setKit:setKit, load:loadKit, state:state, kits:KITS, stats:stats,
  kit:function(){ return kit; },
  onChange:function(fn){ listeners.push(fn); },
  sources:sources, sample:sample, buffers:buffers, prepare:prepare, map:MAP,
  meta:function(){ return meta; },
  /* ไว้ให้ชุดทดสอบตรวจว่าไฟล์ถูกชดเชยหัวเงียบแล้วจริง */
  _bank:bank, _slots:slots
};
})();
