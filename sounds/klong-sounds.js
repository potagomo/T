/* ============================================================
   เสียงกลองจริงของ Klong Pro — ชุดเสียงที่อัดจากกลองจริง

   ไฟล์นี้แยกจากตัวโปรแกรมโดยตั้งใจเหมือน theme/
   index.html มีแค่บรรทัดที่เรียกไฟล์นี้ กับทางเข้าหนึ่งบรรทัดใน playVoice()
     if(window.KlongSounds && window.KlongSounds.play(S.ctx, dSink, key, when, vel)) return;
   ถ้า play() คืน false (เลือกเสียงสังเคราะห์ · ชุดยังโหลดไม่เสร็จ · ไม่มีเสียงอัดของท่านั้น)
   โปรแกรมจะเล่นเสียงสังเคราะห์เดิมต่อ ไม่มีวันเงียบ

   ทำอะไรบ้าง
   1) โหลดเฉพาะชุดที่เลือก (ไม่โหลดทุกชุด) แล้วถอดรหัส MP3 ไว้ล่วงหน้า
      ไฟล์ถูก Service Worker เก็บไว้ในเครื่องถาวร โหลดครั้งเดียวใช้ออฟไลน์ได้
   2) น้ำหนักการตีเลือกชั้นเสียง: เบา (โกสต์) / ปกติ / เน้น — ตรงกับเกณฑ์ของโปรแกรม
      ghostOf() = vel < 55, accentOf() = vel >= 110 แล้วไล่ความดังละเอียดในชั้นตาม vel
   3) สุ่มไฟล์ในชั้นเดียวกันโดยไม่ซ้ำกับครั้งก่อน ตีรัวแล้วไม่ดังเหมือนเครื่อง
   4) ไฮแฮตเปิดถูกตัดเมื่อเหยียบหรือตีไฮแฮตปิดตามมา เหมือนไฮแฮตจริง
      กลองใบเดียวกันตีซ้ำ เสียงเก่าหรี่ลงเร็ว ๆ (หนังกลองถูกตีใหม่) ฉาบปล่อยให้ดังซ้อนได้
   5) วางตำแหน่งซ้าย-ขวาแบบมุมมองคนตี (ชุดโมโน) ชุดอะคูสติกเป็นสเตอริโอจากไมค์จริงอยู่แล้ว
   6) ชดเชยช่วงเงียบหัวไฟล์ MP3 (encoder delay ~25 ms) ที่เบราว์เซอร์บางตัวไม่ตัดให้
      ไม่งั้นเสียงกลองจะช้ากว่าโน้ตบนกริดและเพลงจริง ซึ่งแย่มากสำหรับงานแกะเพลง

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
   ชุดดิบดังกว่าเสียงสังเคราะห์ 11.7-14.3 dB และต่างกันเองตามชุด */
var KITS=[
  {id:"acoustic", th:"อะคูสติก", note:"กลองจริงสเตอริโอ ละเอียดที่สุด", trim:0.327,
   credit:"Salamander Drumkit by Alexander Holm (CC BY-SA 3.0)"},
  {id:"rock",     th:"ร็อก",     note:"หนัก หนา ห้องใหญ่", trim:0.244},
  {id:"pop",      th:"ป๊อป",     note:"สะอาด กระชับ", trim:0.275},
  {id:"jazz",     th:"แจ๊ส",     note:"เบา โปร่ง ฉาบใส", trim:0.244},
  {id:"hiphop",   th:"ฮิปฮอป",   note:"โลไฟ ทอมแบบ 808", trim:0.280},
  {id:"synth",    th:"สังเคราะห์", note:"เสียงเดิมของโปรแกรม ไม่ต้องโหลด"}
];
var DEFAULT="acoustic";

/* เสียงของโปรแกรม (instrument:articulation) → ชิ้นในชุดเสียง
   add:true = ใช้จากชิ้นเสริม (ชุดหลักไม่มี) · pan = ซ้าย(-)/ขวา(+) มุมคนตี
   kind: drum = ตีซ้ำแล้วเสียงเก่าหรี่ · hat = ไฮแฮต (เปิดถูกตัด) · cym = ฉาบ ดังซ้อนได้ */
var MAP={
  "kick":       {c:"BD",    pan: 0.00, kind:"drum"},
  "snare":      {c:"SN",    pan:-0.05, kind:"drum"},
  /* ริมช็อต: ชุดเสียงไม่มีไฟล์ริมช็อตแยก ใช้สแนร์ชั้นเน้นดังขึ้นแทน (ใกล้กว่าเสียงสังเคราะห์) */
  "snare:rim":  {c:"SN",    pan:-0.05, kind:"drum", min:"normal", db:2.5},
  /* ครอสสติ๊กไม่มีไฟล์ — ไม่อยู่ในตารางนี้ โปรแกรมจะเล่นเสียงสังเคราะห์ตามเดิม */
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
/* ค่ากลางของ vel ในแต่ละชั้น (ตรงกับ DYN_VEL ของโปรแกรม) ใช้ไล่ความดังละเอียดในชั้น */
var NOM={ghost:42, normal:100, accent:118};

var kit=DEFAULT;
try{ var sv=localStorage.getItem(KEY); if(sv && KITS.some(function(k){ return k.id===sv; })) kit=sv; }catch(e){}

var meta=null, metaP=null;            // kits.json
var bank={};                          // kitId → {ready, loaded, total, failed, code → {gain, layers:{ghost:[{buf,off}],...}}}
var loads={};                         // kitId → Promise
var listeners=[];
var stats={played:0, fallback:0};
var lastPick={};                      // "kit|code|layer" → ดัชนีล่าสุด (สุ่มไม่ซ้ำ)
var active=[];                        // เสียงที่ยังดังอยู่
var lastCtx=null;

function emit(){ for(var i=0;i<listeners.length;i++){ try{ listeners[i](state()); }catch(e){} } }
function state(){
  var b=bank[kit];
  return {kit:kit, synth:kit==="synth", ready:kit==="synth" || !!(b && b.ready),
          loaded:b?b.loaded:0, total:b?b.total:0, failed:b?b.failed:0, error:b?b.error:""};
}
function dbGain(db){ return Math.pow(10, db/20); }
function kitTrim(id){ for(var i=0;i<KITS.length;i++) if(KITS[i].id===id) return KITS[i].trim||1; return 1; }

function getMeta(){
  if(meta) return Promise.resolve(meta);
  if(!metaP) metaP=fetch(BASE+"kits.json").then(function(r){
    if(!r.ok) throw new Error("kits.json "+r.status);
    return r.json();
  }).then(function(j){ meta=j; return j; }, function(e){ metaP=null; throw e; });
  return metaP;
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

function codesFor(){
  var main={}, add={};
  for(var k in MAP){ if(MAP[k].add) add[MAP[k].c]=1; else main[MAP[k].c]=1; }
  return {main:main, add:add};
}
function loadKit(id){
  if(id==="synth") return Promise.resolve();
  if(loads[id]) return loads[id];
  var b=bank[id]={ready:false, loaded:0, total:0, failed:0, error:"", inst:{}};
  emit();
  loads[id]=getMeta().then(function(j){
    var want=codesFor(), jobs=[];
    j.kits.forEach(function(k){
      var isMain=k.id===id, isAdd=k.id==="addons";
      if(!isMain && !isAdd) return;
      k.instruments.forEach(function(ins){
        if(!(isMain ? want.main[ins.code] : want.add[ins.code])) return;
        var slot=b.inst[ins.code]={gain:ins.playGain||1, layers:{}};
        Object.keys(ins.layers).forEach(function(L){
          slot.layers[L]=[];
          ins.layers[L].forEach(function(f){
            jobs.push({url:BASE+ins.folder+"/"+f, into:slot.layers[L]});
          });
        });
      });
    });
    b.total=jobs.length; emit();
    var next=0;
    function worker(){
      if(next>=jobs.length) return Promise.resolve();
      var job=jobs[next++];
      return getFile(job.url).then(decode).then(function(buf){
        job.into.push({buf:buf, off:onsetOf(buf)});
      }).catch(function(){ b.failed++; })
        .then(function(){ b.loaded++; if(b.loaded%6===0 || b.loaded===b.total) emit(); return worker(); });
    }
    var ws=[]; for(var w=0;w<6;w++) ws.push(worker());
    return Promise.all(ws);
  }).then(function(){
    b.ready = b.loaded>0 && b.failed < b.total;
    if(!b.ready) b.error="โหลดไม่ได้";
    if(!b.ready) delete loads[id];          // ให้ลองใหม่ได้ เช่น ต่อเน็ตแล้ว
    emit();
  }, function(e){
    b.error="โหลดไม่ได้"; delete loads[id]; emit();
  });
  return loads[id];
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
      return {s:arr[j], layer:order[i]};
    }
  }
  return null;
}

function damp(v, at, tau){
  if(v.damped) return;
  v.damped=true;
  var t=Math.max(at, v.t);
  try{
    v.g.gain.setValueAtTime(v.gain, t);
    v.g.gain.setTargetAtTime(0, t, tau);
    v.src.stop(t+tau*8);
  }catch(e){}
}

function play(ctx, sink, key, when, vel){
  if(kit==="synth" || !ctx || !sink) return false;
  var b=bank[kit];
  if(!b || !b.ready){ stats.fallback++; return false; }
  var m=MAP[key];
  if(!m){
    if(key==="snare:cross") return false;                 // ครอสสติ๊ก: เสียงสังเคราะห์
    m=MAP[String(key).split(":")[0]];                     // ท่าอื่นที่ไม่มีไฟล์แยก → เสียงตัวกลองนั้น
    if(!m) return false;
  }
  var slot=b.inst[m.c];                                   // ชิ้นเสริมถูกโหลดเข้าชุดเดียวกันแล้ว
  if(!slot){ stats.fallback++; return false; }
  vel = vel==null ? 100 : vel;
  var L=layerOf(vel, m.min);
  var p=pick(slot, L, kit+"|"+m.c);
  if(!p){ stats.fallback++; return false; }
  var f=vel/NOM[p.layer]; f = f<0.45 ? 0.45 : (f>1.2 ? 1.2 : f);
  var db=((meta && meta.strokeLevelDb_app_default) || {ghost:-8, normal:0, accent:2})[p.layer] || 0;
  var gain=kitTrim(kit) * slot.gain * dbGain(db + (m.db||0)) * f;

  lastCtx=ctx;
  var buf=p.s.buf;
  var src=ctx.createBufferSource(); src.buffer=buf;
  var g=ctx.createGain();
  var out=g, pan=null;
  if(buf.numberOfChannels===1 && m.pan && ctx.createStereoPanner){
    pan=ctx.createStereoPanner(); pan.pan.value=m.pan;
    gain*=Math.SQRT2;                        // ตัวแพนหรี่กลางลง 3 dB ชดเชยให้ดังเท่าไม่แพน
    g.connect(pan); out=pan;
  }
  g.gain.value=gain;
  src.connect(g); out.connect(sink);

  /* จัดการเสียงที่ยังดังค้าง ก่อนเริ่มเสียงใหม่ */
  var now=ctx.currentTime, keep=[];
  for(var i=0;i<active.length;i++){
    var v=active[i];
    if(v.end<now || v.sink!==sink || v.damped && v.t+0.3<now) continue;   // จบแล้ว หรือเป็นของรอบเล่นเก่า
    if(m.kind==="hat" && v.open && !v.damped) damp(v, when, 0.012);       // ไฮแฮตเปิดถูกปิด
    else if(m.kind==="drum" && v.c===m.c && !v.damped) damp(v, when, 0.045);   // หนังกลองถูกตีใหม่
    keep.push(v);
  }
  /* ฉาบใบเดียวกันดังซ้อนได้ แต่ไม่เกิน 5 เสียง และรวมทั้งชุดไม่เกิน 40 เสียง (กันเกินโควตาบน iPad) */
  var same=0;
  for(i=keep.length-1;i>=0;i--){ if(keep[i].c===m.c && !keep[i].damped && ++same>=5) damp(keep[i], when, 0.08); }
  if(keep.length>=40){ for(i=0;i<keep.length-39;i++) damp(keep[i], when, 0.05); }

  src.start(when, p.s.off);
  keep.push({src:src, g:g, gain:gain, t:when, end:when+buf.duration-p.s.off+0.05,
             c:m.c, open:!!m.open, sink:sink, damped:false});
  active=keep;
  stats.played++;
  return true;
}

function setKit(id){
  if(!KITS.some(function(k){ return k.id===id; })) return;
  kit=id;
  try{ localStorage.setItem(KEY, id); }catch(e){}
  emit();
  return loadKit(id);
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
  function info(id){ for(var i=0;i<KITS.length;i++) if(KITS[i].id===id) return KITS[i]; return KITS[0]; }
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
  /* ไว้ให้ชุดทดสอบตรวจว่าไฟล์ถูกชดเชยหัวเงียบแล้วจริง */
  _bank:bank
};
})();
