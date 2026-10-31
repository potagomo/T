/* ============================================================
   แต่งเสียงกลองรายใบ — Klong Pro
   ผู้ใช้ขอ: "ปรับแต่งกลองชุดแต่ละใบแยกได้ จูนเสียง ใส่เอฟเฟกต์ ปรับได้ละเอียดมาก น้ำหนักเสียงต่าง ๆ
            และเสียงคงคุณภาพดีมาก ๆ เช่นเดิม"

   แต่ละใบ (กระเดื่อง สแนร์ ไฮแฮต ทอม ฉาบ …) มีสองส่วน
   1) ต่อการตี (ทำใน sounds/klong-sounds.js และชุดสังเคราะห์ KIT ผ่าน voice()/env()/curve()/tuned())
      · จูน ±12 ครึ่งเสียง ละเอียด 1 เซนต์ — สุ่มอัตราใหม่แบบ windowed-sinc (Kaiser β 9, 24 ช่วงศูนย์)
        ทำเก็บไว้ล่วงหน้า ไม่ใช้ playbackRate (ประมาณค่าเชิงเส้น เสียงแหลมเพี้ยน) ระหว่างรอ ~ไม่กี่สิบ ms ใช้ playbackRate ไปก่อน
      · หัวเสียง (6 ms แรก) / ตัวเสียง / ความยาวเสียง — ตัวแต่งหัวเสียงแบบ transient designer ทำตรงต่อการตี
        (รู้เวลาตีแน่นอน ไม่ต้องเดาจากสัญญาณ)
      · น้ำหนัก: โค้ง (ตีเบาก็ดัง ↔ ต้องตีแรงถึงดัง) · ช่วงไดนามิก · ระดับชั้นเบา/เน้น
      · แหล่งเสียง: ใบเดียวกันจากชุดอื่น หรือชิ้นเสริมขนาดอื่น · ระดับ/แหล่งของแต่ละท่า (ริมช็อต ครอสสติ๊ก ไฮแฮตเปิด …)
   2) สายเสียงของใบ (สร้างต่อบัสกลองของรอบเล่น ตัดพร้อมบัสเมื่อหยุด): HPF → EQ 3 ย่าน → LPF → คอมเพรสเซอร์ → แซต → ระดับ → ห้อง
      ขั้นที่ปิดอยู่ไม่ต่อเข้าสายเลย (ค่าเริ่มต้น = เสียงผ่านตรงเหมือนเดิมทุกบิต)
      คอมเพรสเซอร์/แซตของ Web Audio หน่วงเวลา (มองล่วงหน้า ~6 ms / oversample) — วัดจริงต่ออัตราตัวอย่าง
      แล้วเลื่อนการตีของใบนั้นขึ้นก่อนเท่ากัน (latency()) กลองจึงยังตรงกริด
   ห้อง (reverb) ย้ายมาอยู่ที่นี่จาก KIT: IR สร้างเองแบบเดิม (ห้องเล็ก ~0.9 วิ) ส่งเข้าห้องรายใบได้ 0–200 %

   ค่าทั้งหมดจำแยกต่อชุดเสียง (localStorage klongpro.kitfx.v1) — จูนของชุดร็อกไม่ไปทับชุดอะคูสติก
   หน้าแต่งเสียง (#kfx) สร้างจากสคริปต์นี้ทั้งหมด index.html มีแค่ปุ่มเปิด + ทางเข้าใน playVoice/newSinks/vxMix
   สีบน canvas ใช้เฉพาะสีที่ธีมรู้จัก (theme/klong-theme.js MAP) ไม่งั้นชุดทดสอบฟ้อง "สีหลุดธีม"
   ============================================================ */
(function(){
"use strict";
var STORE="klongpro.kitfx.v1";

/* ใบกลอง → เสียงของโปรแกรม (instrument:articulation) · สี = สีเสียงในกริด (ธีมแปลงให้) */
var PIECES=[
  {id:"kick",   th:"กระเดื่อง", keys:["kick"],                          color:"#f0a02e"},
  {id:"snare",  th:"สแนร์",     keys:["snare","snare:rim","snare:cross"], color:"#e2564a"},
  {id:"hihat",  th:"ไฮแฮต",     keys:["hihat","hihat:open","hhf"],      color:"#4fc8d4"},
  {id:"tom1",   th:"ทอม 1",     keys:["tom1"],                          color:"#c8a0f0"},
  {id:"tom2",   th:"ทอม 2",     keys:["tom2"],                          color:"#b98be8"},
  {id:"floor",  th:"ฟลอร์ทอม",  keys:["floor"],                         color:"#9a6fd0"},
  {id:"crash",  th:"แครช 1",    keys:["crash"],                         color:"#c3d44f"},
  {id:"crash2", th:"แครช 2",    keys:["crash2"],                        color:"#a8c44a"},
  {id:"ride",   th:"ไรด์",      keys:["ride","bell"],                   color:"#cbd45f"},
  {id:"china",  th:"ไชน่า",     keys:["china"],                         color:"#8fb03c"},
  {id:"splash", th:"สแปลช",     keys:["splash"],                        color:"#dce887"},
  {id:"cow",    th:"คาวเบล",    keys:["cow"],                           color:"#e8a0c8"}
];
var ART_TH={"kick":"ตี", "snare":"ตีหนัง", "snare:rim":"ริมช็อต", "snare:cross":"ครอสสติ๊ก",
  "hihat":"ปิด", "hihat:open":"เปิด", "hhf":"เหยียบ", "tom1":"ตี", "tom2":"ตี", "floor":"ตี",
  "crash":"ตี", "crash2":"ตี", "ride":"ตัวฉาบ", "bell":"เบล", "china":"ตี", "splash":"ตี", "cow":"ตี"};
var PIECE_OF={};
PIECES.forEach(function(p){ p.keys.forEach(function(k){ PIECE_OF[k]=p.id; }); });
function pieceOf(key){ key=String(key||""); return PIECE_OF[key] || PIECE_OF[key.split(":")[0]] || null; }
function pieceInfo(id){ for(var i=0;i<PIECES.length;i++) if(PIECES[i].id===id) return PIECES[i]; return null; }

/* ค่าเริ่มต้น = เสียงเดิมทุกอย่าง (ghost −8 / accent +2 ตรงกับ strokeLevelDb_app_default ของ kits.json) */
var DEF={vol:0, pan:null, tune:0, dyn:100, curve:0, ghost:-8, accent:2, atk:0, body:0, len:100,
  hp:20, lsG:0, lsF:120, pkG:0, pkF:1000, pkQ:1, hsG:0, hsF:8000, lp:20000,
  cmp:0, cThr:-20, cRat:4, cAtk:8, cRel:120, cMk:0, sat:0, room:100, by:0};
var GDEF={room:100, size:100};
var ADEF={db:0, src:""};

var store={v:1, kits:{}, g:{}};
try{ var sv=JSON.parse(localStorage.getItem(STORE)); if(sv && sv.v===1 && sv.kits) store=sv; if(!store.g) store.g={}; }catch(e){}
var saveT=0;
function save(){ clearTimeout(saveT); saveT=setTimeout(function(){ try{ localStorage.setItem(STORE, JSON.stringify(store)); }catch(e){} }, 250); }
function SND(){ return window.KlongSounds || null; }
function curKit(){ var s=SND(); return s ? s.kit() : "synth"; }
function raw(kit, pid){ var k=store.kits[kit]; return k && k[pid] || null; }
function P(kit, pid){                                    // ค่าที่มีผลของใบนี้ (รวมค่าเริ่มต้น)
  var r=raw(kit, pid), o={}, k;
  for(k in DEF) o[k] = r && r[k]!=null && k!=="art" ? r[k] : DEF[k];
  if(r && r.pan===null) o.pan=null;
  o.art={}; var a=(r && r.art) || {};
  for(k in a) o.art[k]={db:a[k].db!=null ? a[k].db : 0, src:a[k].src||""};
  o.src = r && r.src || "";
  return o;
}
function G(){ var o={}; for(var k in GDEF) o[k]=store.g[k]!=null ? store.g[k] : GDEF[k]; return o; }
function edited(kit, pid){
  var r=raw(kit, pid); if(!r) return false;
  for(var k in DEF) if(r[k]!=null && r[k]!==DEF[k] && k!=="by") return true;
  if(r.src) return true;
  for(var a in (r.art||{})) if(r.art[a].db || r.art[a].src) return true;
  return false;
}
function dbg(db){ return Math.pow(10, db/20); }

/* ---------- ต่อการตี ---------- */
var vcache={};
function neutral(){ return {src:"", cents:0, dyn:1, cexp:1, ghost:-8, accent:2, atk:0, body:0, len:1, pan:null, artDb:0}; }
/* แหล่งของใบ ("kit:…" ใช้กับทุกท่าที่เปลี่ยนชุดได้ · "add:…" ใช้กับท่าหลักของใบเท่านั้น) */
function pieceSrcFor(key, src){
  if(!src) return "";
  var s=SND(); if(!s) return "";
  var alt=s.sources(key).map(function(x){ return x.id; });
  return alt.indexOf(src)>=0 ? src : "";
}
function voice(kit, key){
  var ck=kit+"|"+key; if(vcache[ck]) return vcache[ck];
  var pid=pieceOf(key), v;
  if(!pid) v=neutral();
  else {
    var p=P(kit, pid);
    if(p.by) v=neutral();
    else {
      var base=PIECE_OF[key] ? key : String(key).split(":")[0], a=p.art[base] || ADEF;
      v={src: a.src || pieceSrcFor(base, p.src), cents:Math.round(p.tune), dyn:p.dyn/100, cexp:Math.pow(2, p.curve/100),
         ghost:p.ghost, accent:p.accent, atk:p.atk, body:p.body, len:p.len/100,
         pan:p.pan==null ? null : p.pan/100, artDb:a.db||0};
    }
  }
  vcache[ck]=v; return v;
}
function cur(key){ return voice(curKit(), key); }
function curve(vel, fx){
  if(!fx || fx.cexp===1) return vel;
  var v=Math.max(1, Math.min(127, vel))/127;
  return Math.max(1, Math.min(127, 127*Math.pow(v, fx.cexp)));
}
/* หัว/ตัว/ความยาวเสียงบน gain ของการตีหนึ่งครั้ง → {at(t) ระดับ ณ เวลา, stop} หรือ null ถ้าไม่ได้แต่ง */
function env(p, when, gain, dur, fx){
  if(!fx) return null;
  var A=dbg(fx.atk||0), B=dbg(fx.body||0), len=fx.len==null ? 1 : fx.len;
  if(A===1 && B===1 && len>=0.999) return null;
  var t1=when+0.006, t2=when+0.03, fadeT=null, tau=0, stop;
  p.setValueAtTime(gain*A, when);
  p.setValueAtTime(gain*A, t1);
  p.linearRampToValueAtTime(gain*B, t2);
  if(len<0.999){
    var L=Math.max(0.02, dur*len);
    fadeT=Math.max(t2, when+L*0.55); tau=Math.max(0.004, L*0.15);
    p.setTargetAtTime(0, fadeT, tau); stop=fadeT+tau*8;
  }
  return {stop:stop, at:function(t){
    var d=t-when;
    if(d<=0.006) return gain*A;
    if(d<0.03) return gain*(A+(B-A)*(d-0.006)/0.024);
    if(fadeT!=null && t>fadeT) return gain*B*Math.exp(-(t-fadeT)/tau);
    return gain*B;
  }};
}

/* ---------- จูนคุณภาพสูง: สุ่มอัตราใหม่ด้วย windowed-sinc ---------- */
var NZ=24, RES=512, TAB=null;
function i0(x){ var s=1, t=1, k=1; for(;k<40;k++){ t*=(x/2)/k; s+=t*t; if(t*t<1e-12*s) break; } return s; }
function table(){
  if(TAB) return TAB;
  var n=NZ*RES+2, b=9, ib=i0(b); TAB=new Float32Array(n);
  for(var i=0;i<n;i++){
    var x=i/RES, s = x===0 ? 1 : Math.sin(Math.PI*x)/(Math.PI*x), r=x/NZ;
    TAB[i] = r>=1 ? 0 : s*i0(b*Math.sqrt(1-r*r))/ib;
  }
  return TAB;
}
function resample(inp, r){
  var T=table(), n=Math.max(1, Math.floor(inp.length/r)), out=new Float32Array(n);
  var fc=Math.min(1, 1/r), half=NZ/fc, L=inp.length, sc=fc*RES;
  for(var i=0;i<n;i++){
    var pos=i*r, j0=Math.max(0, Math.ceil(pos-half)), j1=Math.min(L-1, Math.floor(pos+half)), s=0;
    for(var j=j0;j<=j1;j++){
      var x=(j-pos)*sc; if(x<0) x=-x;
      var xi=x|0, fr=x-xi;
      s+=inp[j]*(T[xi]+(T[xi+1]-T[xi])*fr);
    }
    out[i]=s*fc;
  }
  return out;
}
var tunedMap=(typeof WeakMap!=="undefined") ? new WeakMap() : null, tq=[], tbusy=false, tWait=[];
var mkCtx=null;
function newBuf(ch, n, sr){
  try{ return new AudioBuffer({length:n, numberOfChannels:ch, sampleRate:sr}); }
  catch(e){ if(!mkCtx){ var O=window.OfflineAudioContext||window.webkitOfflineAudioContext; mkCtx=new O(1,1,sr); } return mkCtx.createBuffer(ch, n, sr); }
}
function tuned(buf, cents){
  if(!cents || !tunedMap) return null;
  var m=tunedMap.get(buf); if(!m){ m={}; tunedMap.set(buf, m); }
  var h=m[cents];
  if(h && h!=="wait") return h;
  if(!h){ m[cents]="wait"; tq.push([buf, cents, m]); pumpT(); }
  return null;
}
function pumpT(){
  if(tbusy) return;
  if(!tq.length){ var w=tWait; tWait=[]; w.forEach(function(f){ f(); }); return; }
  tbusy=true;
  setTimeout(function(){
    var j=tq.shift(), buf=j[0], cents=j[1], r=Math.pow(2, cents/1200);
    try{
      var ch=buf.numberOfChannels, outs=[];
      for(var c=0;c<ch;c++) outs.push(resample(buf.getChannelData(c), r));
      var nb=newBuf(ch, outs[0].length, buf.sampleRate);
      for(c=0;c<ch;c++) nb.getChannelData(c).set(outs[c]);
      j[2][cents]=nb;
    }catch(e){ delete j[2][cents]; }
    tbusy=false; pumpT();
  }, 0);
}
function tunedIdle(){ return new Promise(function(ok){ if(!tq.length && !tbusy) ok(); else tWait.push(ok); }); }

/* ---------- สายเสียงของใบ ---------- */
var groups=[];                 // {ctx, sink, wet, strips:{}, dead}
var rooms=[];                  // {ctx, dst, conv, wet, size}
function roomIR(ctx, size){
  var sr=ctx.sampleRate, k=Math.max(0.3, size/100), len=Math.floor(Math.min(3.2, 0.9*k)*sr), ir=ctx.createBuffer(2, len, sr);
  var s=7;
  var rnd=function(){ s^=s<<13; s>>>=0; s^=s>>>17; s^=s<<5; s>>>=0; return s/4294967296*2-1; };
  for(var ch=0; ch<2; ch++){
    var d=ir.getChannelData(ch), lp=0;
    for(var i=0;i<len;i++){
      var t=i/sr, a = t<0.008 ? 0 : Math.exp(-t/(0.17*k));
      lp += (rnd()-lp)*(0.55-0.4*Math.min(1, t/(0.6*k)));
      d[i]=lp*a;
    }
  }
  return ir;
}
function roomOf(ctx, dst){
  for(var i=0;i<rooms.length;i++) if(rooms[i].ctx===ctx && rooms[i].dst===dst) return rooms[i];
  var g=G(), r={ctx:ctx, dst:dst, conv:ctx.createConvolver(), wet:ctx.createGain(), size:g.size};
  r.conv.buffer=roomIR(ctx, g.size); r.wet.gain.value=0.22*g.room/100;
  r.conv.connect(r.wet); r.wet.connect(dst);
  rooms.push(r); if(rooms.length>6) rooms.shift();
  return r;
}
function groupOf(ctx, sink){
  for(var i=groups.length-1;i>=0;i--) if(groups[i].sink===sink) return groups[i];
  var g={ctx:ctx, sink:sink, wet:null, strips:{}, dead:0};
  groups.push(g);
  if(groups.length>8){ var k=groups.findIndex(function(x){ return x.dead; }); groups.splice(k>=0 ? k : 0, 1); }
  return g;
}
/* บัสกลองชุดใหม่ของรอบเล่น (newSinks / มิกซ์วิดีโอ) — ห้องอยู่ต่อปลายทางเดียวกับบัส */
function route(ctx, sink, dst){
  var g=groupOf(ctx, sink), r=roomOf(ctx, dst);
  g.wet=ctx.createGain(); g.wet.connect(r.conv);
}
/* หยุดเล่น: ปิดทางเข้าห้องของบัสเก่าพร้อมบัส (เสียงที่จองไว้ล่วงหน้าจะได้ไม่ไปโผล่ในห้อง) */
function cut(sink, t){
  for(var i=0;i<groups.length;i++){
    var g=groups[i]; if(g.sink!==sink) continue;
    g.dead=1;
    if(g.wet){ try{ g.wet.gain.cancelScheduledValues(t); g.wet.gain.setValueAtTime(0, t); }catch(e){} var w=g.wet; setTimeout(function(){ try{ w.disconnect(); }catch(e){} }, 80); }
  }
}
function input(ctx, sink, key){
  var pid=pieceOf(key); if(!pid) return null;
  var g=groupOf(ctx, sink);
  return (g.strips[pid] || (g.strips[pid]=mkStrip(g, pid))).inp;
}
function eff(pid){ var p=P(curKit(), pid); return p.by ? Object.assign({}, DEF) : p; }
function mkStrip(g, pid){
  var c=g.ctx, s={pid:pid, c:c, key:"", satKey:""};
  s.inp=c.createGain(); s.inp.channelCount=2; s.inp.channelCountMode="explicit"; s.inp.channelInterpretation="speakers";
  var bq=function(t, q){ var f=c.createBiquadFilter(); f.type=t; if(q) f.Q.value=q; return f; };
  s.hp=bq("highpass", 0.7071); s.ls=bq("lowshelf"); s.pk=bq("peaking"); s.hs=bq("highshelf"); s.lp=bq("lowpass", 0.7071);
  s.cmp=c.createDynamicsCompressor(); s.mk=c.createGain();
  s.si=c.createGain(); s.sh=c.createWaveShaper(); s.sh.oversample="4x"; s.so=c.createGain();
  s.vol=c.createGain(); s.vol.connect(g.sink);
  s.send=c.createGain(); s.vol.connect(s.send); if(g.wet) s.send.connect(g.wet);
  applyStrip(s, eff(pid), true);
  return s;
}
var SAT_K=24;
function satCurve(){ var n=2048, cv=new Float32Array(n); for(var i=0;i<n;i++){ var u=i/(n-1)*2-1; cv[i]=Math.tanh(u*SAT_K); } return cv; }
var SATC=null;
function onOf(p){ return {hp:p.hp>20.5, ls:p.lsG!==0, pk:p.pkG!==0, hs:p.hsG!==0, lp:p.lp<19990, cmp:!!p.cmp, sat:p.sat>0}; }
function applyStrip(s, p, now){
  var t=s.c.currentTime;
  var set=function(prm, v){ if(now) prm.value=v; else try{ prm.cancelScheduledValues(t); prm.setTargetAtTime(v, t, 0.012); }catch(e){ prm.value=v; } };
  set(s.hp.frequency, p.hp); set(s.lp.frequency, Math.min(p.lp, s.c.sampleRate*0.49));
  set(s.ls.frequency, p.lsF); set(s.ls.gain, p.lsG);
  set(s.pk.frequency, p.pkF); set(s.pk.gain, p.pkG); set(s.pk.Q, p.pkQ);
  set(s.hs.frequency, p.hsF); set(s.hs.gain, p.hsG);
  s.cmp.threshold.value=p.cThr; s.cmp.ratio.value=p.cRat; s.cmp.knee.value=6;
  s.cmp.attack.value=p.cAtk/1000; s.cmp.release.value=p.cRel/1000;
  set(s.mk.gain, dbg(p.cMk));
  if(p.sat>0){
    var d=p.sat/100, k=dbg(d*24), m=satMakeup(k);
    if(!SATC) SATC=satCurve();
    if(!s.sh.curve) s.sh.curve=SATC;
    set(s.si.gain, k/SAT_K); set(s.so.gain, m);
  }
  set(s.vol.gain, dbg(p.vol));
  set(s.send.gain, p.room/100);
  var on=onOf(p), key=JSON.stringify(on);
  if(key===s.key) return;
  s.key=key;
  [s.inp, s.hp, s.ls, s.pk, s.hs, s.lp, s.cmp, s.mk, s.si, s.sh, s.so].forEach(function(n){ try{ n.disconnect(); }catch(e){} });
  var chain=[s.inp];
  if(on.hp) chain.push(s.hp);
  if(on.ls) chain.push(s.ls);
  if(on.pk) chain.push(s.pk);
  if(on.hs) chain.push(s.hs);
  if(on.lp) chain.push(s.lp);
  if(on.cmp){ chain.push(s.cmp); chain.push(s.mk); }
  if(on.sat){ chain.push(s.si); chain.push(s.sh); chain.push(s.so); }
  chain.push(s.vol);
  for(var i=0;i<chain.length-1;i++) chain[i].connect(chain[i+1]);
}
/* แซต: ชดเชยความดังให้ใกล้เดิม (เทียบคลื่นไซน์ยอด 0.25 — ระดับของการตีทั่วไปในบัส) ผู้ใช้จะได้ฟังความต่างของสี ไม่ใช่ความดัง */
var mkCache={};
function satMakeup(k){
  var key=k.toFixed(3); if(mkCache[key]) return mkCache[key];
  var a=0, b=0; for(var i=0;i<256;i++){ var x=0.25*Math.sin(i/256*2*Math.PI); a+=x*x; var y=Math.tanh(k*x); b+=y*y; }
  return (mkCache[key]=Math.sqrt(a/(b||1e-12)));
}
function applyAll(pid){
  groups.forEach(function(g){ if(g.dead) return; for(var id in g.strips) if(!pid || id===pid) applyStrip(g.strips[id], eff(id)); });
}
function applyRooms(){
  var g=G();
  rooms.forEach(function(r){
    try{ r.wet.gain.setTargetAtTime(0.22*g.room/100, r.ctx.currentTime, 0.02); }catch(e){ r.wet.gain.value=0.22*g.room/100; }
    if(r.size!==g.size){ r.size=g.size; try{ r.conv.buffer=roomIR(r.ctx, g.size); }catch(e){} }
  });
}

/* ความหน่วงของคอมเพรสเซอร์/แซต วัดจริงด้วยแรงกระตุ้นผ่านโหนดในบริบทออฟไลน์ (ต่ออัตราตัวอย่าง) */
var LAT={}, latP={};
function measure(sr){
  if(latP[sr]) return latP[sr];
  var O=window.OfflineAudioContext||window.webkitOfflineAudioContext;
  var one=function(make){
    try{
      var n=Math.round(sr*0.1), o=new O(1, n, sr), b=o.createBuffer(1, n, sr), at=Math.round(sr*0.01);
      b.getChannelData(0)[at]=0.25;
      var src=o.createBufferSource(); src.buffer=b; var node=make(o); src.connect(node); node.connect(o.destination); src.start();
      return o.startRendering().then(function(r){
        var d=r.getChannelData(0), pk=0, k=at; for(var i=0;i<d.length;i++){ var v=Math.abs(d[i]); if(v>pk){ pk=v; k=i; } }
        return Math.max(0, k-at)/sr;
      }, function(){ return 0; });
    }catch(e){ return Promise.resolve(0); }
  };
  latP[sr]=Promise.all([
    one(function(o){ var c=o.createDynamicsCompressor(); c.threshold.value=0; c.ratio.value=1; return c; }),
    one(function(o){ var w=o.createWaveShaper(); if(!SATC) SATC=satCurve(); w.curve=SATC; w.oversample="4x"; return w; })
  ]).then(function(v){ LAT[sr]={cmp:v[0], sat:v[1]}; return LAT[sr]; });
  return latP[sr];
}
function latency(ctx, key){
  var pid=pieceOf(key); if(!pid || !ctx) return 0;
  var p=eff(pid); if(!p.cmp && !(p.sat>0)) return 0;
  var sr=ctx.sampleRate, L=LAT[sr];
  if(!L){ measure(sr); L={cmp:256/sr, sat:0}; }                // ระหว่างรอวัด: ค่าที่รู้ของ Chrome/WebKit (มองล่วงหน้า 256 ตัวอย่าง)
  return (p.cmp ? L.cmp : 0) + (p.sat>0 ? L.sat : 0);
}

/* ---------- เปลี่ยนค่า ---------- */
var subs=[];
function changed(pid, structural){
  vcache={};
  applyAll(pid);
  save();
  if(structural) warm(curKit());
  subs.forEach(function(f){ try{ f(pid); }catch(e){} });
}
function setP(pid, k, v){
  var kit=curKit(), K=store.kits[kit] || (store.kits[kit]={}), r=K[pid] || (K[pid]={});
  if(v===DEF[k] && k!=="pan") delete r[k]; else r[k]=v;
  changed(pid, k==="tune" || k==="src");
}
function setArt(pid, key, k, v){
  var kit=curKit(), K=store.kits[kit] || (store.kits[kit]={}), r=K[pid] || (K[pid]={}), a=r.art || (r.art={}), x=a[key] || (a[key]={});
  if(v===ADEF[k]) delete x[k]; else x[k]=v;
  if(!x.db && !x.src) delete a[key];
  changed(pid, k==="src");
}
function resetPiece(pid){ var K=store.kits[curKit()]; if(K) delete K[pid]; changed(pid, true); }
function resetKit(){ delete store.kits[curKit()]; store.g={}; applyRooms(); changed(null, true); }
function setG(k, v){ if(v===GDEF[k]) delete store.g[k]; else store.g[k]=v; save(); applyRooms(); subs.forEach(function(f){ try{ f(null); }catch(e){} }); }

/* เตรียมของที่ต้องใช้: ชิ้นที่เปลี่ยนแหล่ง (โหลด) + เสียงที่จูนไว้ (สุ่มอัตราใหม่) — ส่งออกวิดีโอรอให้ครบก่อน */
function warm(kit){
  var s=SND(); if(!s || kit==="synth") return Promise.resolve();
  return s.prepare(kit).then(function(){
    PIECES.forEach(function(p){
      var cents=Math.round(P(kit, p.id).tune); if(!cents || P(kit, p.id).by) return;
      p.keys.forEach(function(key){ s.buffers(kit, key).forEach(function(b){ tuned(b, cents); }); });
    });
  });
}
function prepare(sr){
  return Promise.all([44100, 48000, sr||44100].map(measure)).then(function(){ return warm(curKit()); }).then(tunedIdle);
}

/* ---------- ชุดของฉัน: บันทึกค่าที่แต่งทั้งชุดเป็น preset ส่วนตัว 5 ช่อง อยู่ถาวรจนกว่าผู้ใช้ลบเอง ----------
   ผู้ใช้ขอ: "Save ค่าที่ปรับทั้งหมดเป็น Preset ส่วนตัวได้สูงสุด 5 ชุดกลอง คงอยู่ตลอดไม่หายไปไหนจนกว่าจะกดลบเอง"
   หนึ่งชุด = ชุดเสียงพื้นฐาน + ค่าทุกใบของชุดนั้น (จูน EQ แหล่งเสียง …) + ห้องทั้งชุด
   เก็บสองที่: localStorage (อ่านทันทีตอนเปิด) + IndexedDB (สำเนา — localStorage เต็ม/หายเมื่อไร กู้จากตรงนี้)
   และขอสิทธิ์ "เก็บถาวร" จากเบราว์เซอร์ (ไม่ถูกล้างเองตอนที่เก็บในเครื่องเหลือน้อย) · สำรองเป็นไฟล์ / นำเข้าไฟล์ได้ (ย้ายเครื่องได้) */
var PKEY="klongpro.kitfx.presets.v1", PMAX=5;
var pre={v:1, list:[], active:-1}, preWarn="";
function preFix(o){
  var out={v:1, list:[], active:-1};
  if(o && Array.isArray(o.list)) for(var i=0;i<PMAX;i++) out.list.push(clean(o.list[i]));
  while(out.list.length<PMAX) out.list.push(null);
  out.active = o && typeof o.active==="number" && out.list[o.active] ? o.active : -1;
  return out;
}
/* รับเฉพาะค่าที่รู้จัก (ไฟล์นำเข้าอาจมาจากรุ่นอื่น/แก้มือ) */
function clean(p){
  if(!p || typeof p!=="object" || typeof p.kit!=="string") return null;
  var kits=(SND() ? SND().kits : []).map(function(k){ return k.id; });
  if(kits.length && kits.indexOf(p.kit)<0) return null;
  var o={name:String(p.name||"ชุดของฉัน").slice(0, 40), kit:p.kit, pieces:{}, g:{}, at:+p.at||Date.now()};
  PIECES.forEach(function(pc){
    var r=p.pieces && p.pieces[pc.id]; if(!r || typeof r!=="object") return;
    var x={};
    for(var k in DEF) if(typeof r[k]==="number" && isFinite(r[k])) x[k]=r[k];
    if(typeof r.src==="string" && r.src) x.src=r.src;
    if(r.art && typeof r.art==="object"){ var a={}; pc.keys.forEach(function(key){ var v=r.art[key]; if(!v) return; var y={};
      if(typeof v.db==="number" && isFinite(v.db) && v.db) y.db=v.db; if(typeof v.src==="string" && v.src) y.src=v.src; if(y.db!=null || y.src) a[key]=y; });
      if(Object.keys(a).length) x.art=a; }
    if(Object.keys(x).length) o.pieces[pc.id]=x;
  });
  if(p.g) for(var k in GDEF) if(typeof p.g[k]==="number" && isFinite(p.g[k])) o.g[k]=p.g[k];
  return o;
}
try{ pre=preFix(JSON.parse(localStorage.getItem(PKEY))); }catch(e){ pre=preFix(null); }
var IDBN="klongpro-kitfx";
function idb(fn){
  return new Promise(function(ok){
    try{
      if(!window.indexedDB) return ok(null);
      var rq=indexedDB.open(IDBN, 1);
      rq.onupgradeneeded=function(){ rq.result.createObjectStore("kv"); };
      rq.onsuccess=function(){ var db=rq.result; try{ fn(db.transaction("kv", "readwrite").objectStore("kv"), function(v){ ok(v); db.close(); }); }catch(e){ ok(null); db.close(); } };
      rq.onerror=function(){ ok(null); };
    }catch(e){ ok(null); }
  });
}
function savePre(){
  var s=JSON.stringify(pre); preWarn="";
  try{ localStorage.setItem(PKEY, s); }catch(e){ preWarn="บันทึกในเครื่อง (ที่เก็บหลัก) ไม่สำเร็จ — เก็บสำเนาไว้แล้ว แนะนำกด \"สำรองเป็นไฟล์\""; }
  idb(function(st, done){ var r=st.put(s, "presets"); r.onsuccess=function(){ done(true); }; r.onerror=function(){ done(false); }; });
}
/* เปิดแอปแล้ว localStorage ไม่มีชุดของฉัน (ถูกล้าง/เต็ม) แต่สำเนาใน IndexedDB ยังอยู่ → กู้คืน */
function restorePre(){
  return idb(function(st, done){ var r=st.get("presets"); r.onsuccess=function(){ done(r.result||null); }; r.onerror=function(){ done(null); }; }).then(function(v){
    if(!v) { if(pre.list.some(Boolean)) savePre(); return; }
    var have=pre.list.some(Boolean);
    if(!have){ try{ pre=preFix(JSON.parse(v)); if(pre.list.some(Boolean)){ try{ localStorage.setItem(PKEY, v); }catch(e){} emitP(); } }catch(e){} }
  });
}
var persisted=null;
function askPersist(){
  try{
    if(!navigator.storage || !navigator.storage.persist) return;
    navigator.storage.persist().then(function(ok){ persisted=!!ok; emitP(); }, function(){});
  }catch(e){}
}
function clone(o){ return JSON.parse(JSON.stringify(o||{})); }
/* รูปแบบเทียบ: ตัดช่องว่าง (ใบที่ถูกรีเซ็ตเหลือ {} ) เรียงคีย์ */
function canon(o){
  if(o===null || typeof o!=="object") return JSON.stringify(o);
  var ks=Object.keys(o).sort(), parts=[];
  ks.forEach(function(k){ var v=o[k]; if(v && typeof v==="object" && !Object.keys(v).length) return; if(v===undefined) return; parts.push(JSON.stringify(k)+":"+canon(v)); });
  return "{"+parts.join(",")+"}";
}
function snapNow(){ var k=curKit(); return {kit:k, pieces:clone(store.kits[k]), g:clone(store.g)}; }
function activeIdx(){ var i=pre.active; return i>=0 && pre.list[i] && pre.list[i].kit===curKit() ? i : -1; }
function sameAs(p){ var s=snapNow(); return !!p && p.kit===s.kit && canon(p.pieces)===canon(s.pieces) && canon(p.g)===canon(s.g); }
function snapOf(k){ return {kit:k, pieces:clone(store.kits[k]), g:clone(store.g)}; }
/* ค่าที่แต่งไว้ของชุดเสียง k ยังไม่อยู่ในชุดของฉันชุดไหนเลย (และไม่ใช่ค่าเริ่มต้น) */
function unsavedOf(k){
  var s=snapOf(k); if(canon(s.pieces)==="{}" && canon(s.g)==="{}") return false;
  return !pre.list.some(function(p){ return p && p.kit===k && canon(p.pieces)===canon(s.pieces) && canon(p.g)===canon(s.g); });
}
/* เรียกชุด p แล้วจะทับค่าที่ยังไม่บันทึกไหม — ทั้งชุดเสียงที่ใช้อยู่ และชุดเสียงของ p (อาจแต่งค้างไว้แล้วสลับไปชุดอื่น) */
function loses(p){ return unsavedOf(curKit()) || (p.kit!==curKit() && unsavedOf(p.kit)); }
function presetSave(i, name){
  var s=snapNow();
  pre.list[i]={name:String(name||"").trim().slice(0, 40) || ("ชุดที่ "+(i+1)), kit:s.kit, pieces:s.pieces, g:s.g, at:Date.now()};
  pre.active=i; savePre(); askPersist(); emitP();
}
function presetLoad(i){
  var p=pre.list[i]; if(!p) return false;
  var s=SND(); if(s && s.kit()!==p.kit) s.setKit(p.kit);
  store.kits[p.kit]=clone(p.pieces); store.g=clone(p.g);
  pre.active=i; savePre();
  vcache={}; applyRooms(); applyAll(); save(); warm(p.kit);
  subs.forEach(function(f){ try{ f(null); }catch(e){} });
  emitP(); return true;
}
function presetDel(i){ pre.list[i]=null; if(pre.active===i) pre.active=-1; savePre(); emitP(); }
function presetRename(i, name){ var p=pre.list[i]; if(!p) return; p.name=String(name||"").trim().slice(0, 40) || p.name; savePre(); emitP(); }
function presetFile(){
  return new Blob([JSON.stringify({app:"klong-pro-drumkits", v:1, at:new Date().toISOString(), presets:pre.list}, null, 1)], {type:"application/json"});
}
/* นำเข้า: ใส่ช่องว่างก่อน ถ้าไม่พอถามก่อนแทนที่ทั้งหมด → คืนจำนวนที่นำเข้า */
function presetImport(text, replaceAll){
  var j=JSON.parse(text), list=(j && (j.presets || (j.list))) || [];
  var key=function(p){ return p.name+"|"+p.kit+"|"+canon(p.pieces)+"|"+canon(p.g); };
  var have=pre.list.filter(Boolean).map(key), all=list.map(clean).filter(Boolean);
  var items=all.filter(function(p){ return have.indexOf(key(p))<0; });             // ชุดที่มีอยู่แล้วเหมือนกันทุกค่า ไม่ใส่ซ้ำ
  if(!all.length) throw new Error("ไม่พบชุดกลองในไฟล์นี้");
  if(!items.length) return 0;
  var empty=[]; pre.list.forEach(function(p, i){ if(!p) empty.push(i); });
  if(items.length>empty.length){
    if(!replaceAll) return -items.length;
    pre.list=[]; for(var i=0;i<PMAX;i++) pre.list.push(items[i]||null); pre.active=-1;
  } else items.forEach(function(it, k){ pre.list[empty[k]]=it; });
  savePre(); askPersist(); emitP();
  return Math.min(items.length, PMAX);
}
var psubs=[];
function emitP(){ psubs.forEach(function(f){ try{ f(); }catch(e){} }); }
function kitTh(id){ var s=SND(), k=s && s.kits.filter(function(x){ return x.id===id; })[0]; return k ? k.th : id; }

/* ---------- หน้าแต่งเสียงกลอง ---------- */
var UI=null, sel="snare", testVel=100;
/* ไฟกะพริบที่ปุ่มใบกลอง ตรงเวลาที่เสียงดังจริง (เล่นเพลงอยู่ก็เห็นว่าใบไหนตี) */
function hit(key, when, vel, ctx){
  if(!UI || UI.el.hidden || !ctx || ctx instanceof (window.OfflineAudioContext||function(){})) return;
  var pid=pieceOf(key); if(!pid) return;
  var b=UI.el.querySelector('.kfx-pad[data-p="'+pid+'"]'); if(!b) return;
  setTimeout(function(){ b.classList.add("hit"); setTimeout(function(){ b.classList.remove("hit"); }, 110); }, Math.max(0, (when-ctx.currentTime)*1000));
}
var CSS=
"#kfx{position:fixed;inset:0;z-index:886;background:var(--bg);overflow:auto;-webkit-overflow-scrolling:touch;color:var(--ink)}"+
"#kfx[hidden]{display:none}"+
"body.atkfx header,body.atkfx main.wrap,body.atkfx #tp{display:none}"+
"body.atkfx #insp,body.atkfx #npal,body.atkfx #npPin{display:none !important}"+
"#kfx .kfx-wrap{max-width:1320px;margin:0 auto;padding:calc(14px + var(--sat,0px)) 16px 48px;display:flex;flex-direction:column;gap:12px}"+
"#kfx .kfx-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}"+
"#kfx .kfx-head h1{font-size:20px;margin:0;font-weight:600}"+
"#kfx .kfx-sp{flex:1}"+
"#kfx .kfx-kits{flex-wrap:wrap}"+
"#kfx .kfx-body{display:grid;grid-template-columns:208px minmax(0,1fr);gap:14px;align-items:start}"+
"#kfx .kfx-pads{display:flex;flex-direction:column;gap:6px;position:sticky;top:8px}"+
"#kfx .kfx-pad{display:flex;align-items:center;gap:10px;min-height:46px;padding:0 12px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:inherit;font-size:15px;text-align:left;cursor:pointer;transition:background .08s}"+
"#kfx .kfx-pad .dot{width:12px;height:12px;border-radius:50%;flex:none;box-shadow:0 0 0 2px rgba(0,0,0,.18)}"+
"#kfx .kfx-pad .nm{flex:1}"+
"#kfx .kfx-pad .ed{font-size:11px;color:var(--soft,#E0A64A)}"+
"#kfx .kfx-pad[aria-pressed=true]{border-color:var(--ok);box-shadow:inset 0 0 0 1px var(--ok)}"+
"#kfx .kfx-pad.hit{background:var(--panel2)}"+
"#kfx .kfx-ed{display:flex;flex-direction:column;gap:12px;min-width:0}"+
"#kfx .kfx-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}"+
"#kfx .kfx-top h2{font-size:18px;margin:0;font-weight:600}"+
"#kfx .kfx-top .hint{margin:0;font-size:12.5px;color:var(--dim)}"+
"#kfx .kfx-test{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:var(--panel)}"+
"#kfx .kfx-test .lbl{font-size:12.5px;color:var(--dim)}"+
"#kfx .kfx-hitb{min-width:92px}"+
"#kfx .kfx-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:12px}"+
"#kfx .kfx-card{display:flex;flex-direction:column;gap:6px;padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:var(--panel);min-width:0}"+
"#kfx .kfx-card h3{display:flex;align-items:center;gap:8px;margin:0 0 2px;font-size:14px;font-weight:600}"+
"#kfx .kfx-card h3 .sp{flex:1}"+
"#kfx .kfx-card .note{font-size:12px;color:var(--dim);line-height:1.5;margin:0}"+
"#kfx .kfx-row{display:grid;grid-template-columns:92px minmax(0,1fr) 78px 76px;align-items:center;gap:6px;min-height:40px}"+
"#kfx .kfx-row label{font-size:13px;color:var(--dim);line-height:1.25}"+
"#kfx .kfx-row input[type=range]{width:100%;margin:0;accent-color:var(--ok)}"+
"html[data-kmode] #kfx .kfx-row input[type=range]{accent-color:var(--k-brass,var(--ok))}"+
"#kfx .kfx-v{font:inherit;font-size:13px;font-variant-numeric:tabular-nums;min-height:34px;padding:0 6px;border-radius:7px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}"+
"#kfx .kfx-v.mod{border-color:var(--soft,#E0A64A)}"+
"#kfx .kfx-row input.kfx-in{font:inherit;font-size:16px;width:100%;min-height:34px;box-sizing:border-box;border-radius:7px;border:1px solid var(--ok);background:var(--panel2);color:var(--ink);padding:0 6px}"+
"#kfx .kfx-nud{display:flex;gap:4px}"+
"#kfx .kfx-nud button{flex:1;min-height:34px;border-radius:7px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);font:inherit;font-size:16px;cursor:pointer;touch-action:manipulation;user-select:none;-webkit-user-select:none}"+
"#kfx .kfx-sel{display:grid;grid-template-columns:92px minmax(0,1fr);align-items:center;gap:6px;min-height:40px}"+
"#kfx .kfx-sel label{font-size:13px;color:var(--dim)}"+
"#kfx .kfx-sel select{font:inherit;font-size:14px;min-height:36px;width:100%;border-radius:8px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);padding:0 8px}"+
"#kfx canvas{display:block;width:100%;border-radius:8px;border:1px solid var(--line);touch-action:pan-y}"+
"#kfx .kfx-sub{font-size:12px;color:var(--dimmer);margin:4px 0 0}"+
"#kfx .kfx-cr{font-size:11.5px;color:var(--dimmer);line-height:1.5}"+
"@media (pointer:coarse){#kfx .kfx-v,#kfx .kfx-nud button,#kfx .kfx-sel select,#kfx .btn,#kfx .seg button{min-height:44px}#kfx .kfx-row{min-height:48px}}"+
"#kfx .kfx-pre{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:var(--panel)}"+
"#kfx .kfx-pre-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap}"+
"#kfx .kfx-pre-h b{font-size:15px}"+
"#kfx label.btn{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box}"+
"#kfx .kfx-pre-h .sub{font-size:12.5px;color:var(--dim);line-height:1.45}"+
"#kfx .kfx-pre-slots{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}"+
"#kfx .kfx-slot{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:1px;min-height:58px;padding:7px 11px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);font:inherit;text-align:left;cursor:pointer;min-width:0}"+
"#kfx .kfx-slot .n{font-size:11px;color:var(--dim)}"+
"#kfx .kfx-slot .t{font-size:14.5px;font-weight:600;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}"+
"#kfx .kfx-slot .k{font-size:11.5px;color:var(--dim);max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}"+
"#kfx .kfx-slot.empty{border-style:dashed;background:transparent}"+
"#kfx .kfx-slot.empty .t{font-weight:400;color:var(--dim)}"+
"#kfx .kfx-slot[aria-pressed=true]{border-color:var(--ok);box-shadow:inset 0 0 0 1px var(--ok)}"+
"#kfx .kfx-slot .k.dirty{color:var(--soft,#E0A64A)}"+
"#kfx .kfx-pre-act{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-height:44px}"+
"#kfx .kfx-pre-act .msg{font-size:12.5px;color:var(--dim);line-height:1.45;flex:1 1 220px}"+
"#kfx .kfx-pre-act .msg.warn{color:var(--warn)}"+
"#kfx .kfx-pre-act input{font:inherit;font-size:16px;min-height:44px;box-sizing:border-box;border-radius:8px;border:1px solid var(--ok);background:var(--panel2);color:var(--ink);padding:0 10px;flex:1 1 180px;min-width:0}"+
".kfx-q{display:flex;flex-direction:column;gap:4px;margin-top:2px}"+
".kfx-q[hidden]{display:none}"+
".kfx-q .h{font-size:12px;color:var(--dim)}"+
".kfx-q .seg{flex-wrap:wrap}"+
".kfx-q .seg button{max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"+
"@media (pointer:coarse){.kfx-q .seg button{min-height:44px}}"+
"@media (max-width:760px){#kfx .kfx-kits{flex-wrap:nowrap;overflow-x:auto;max-width:100%;scrollbar-width:none}#kfx .kfx-kits button{flex:none}"+
"#kfx .kfx-pre-slots{display:flex;overflow-x:auto;scrollbar-width:none}#kfx .kfx-slot{flex:none;width:136px}}"+
"@media (max-width:560px){#kfx .kfx-sel{grid-template-columns:1fr;gap:2px}#kfx .kfx-sel label{font-size:12.5px}}"+
"@media (max-width:760px){#kfx .kfx-body{grid-template-columns:1fr}#kfx .kfx-pads{position:static;flex-direction:row;overflow-x:auto;padding-bottom:4px;scrollbar-width:none}#kfx .kfx-pad{flex:none}#kfx .kfx-cards{grid-template-columns:1fr}}"+
"@media (max-width:420px){#kfx .kfx-row{grid-template-columns:78px minmax(0,1fr) 70px 66px}#kfx .kfx-sel{grid-template-columns:78px minmax(0,1fr)}}";

/* ช่องปรับค่า: [ชื่อ] [แถบเลื่อน] [ค่า — แตะพิมพ์ · แตะสองครั้งคืนค่าเดิม] [− +] กดค้างที่ − + เลื่อนต่อเนื่อง */
var PARAMS={
  tune:{th:"จูน", min:-1200, max:1200, step:1, unit:"ครึ่งเสียง", scale:100, fmt:function(v){ return (v>0?"+":"")+(v/100).toFixed(2); }},
  vol:{th:"ระดับ", min:-48, max:12, step:0.1, unit:"dB", fmt:db1},
  pan:{th:"แพน", min:-100, max:100, step:1, fmt:function(v){ return v===0 ? (stereoSel() && P(curKit(), sel).pan==null ? "ตามไมค์" : "กลาง") : (v<0 ? "L "+(-v) : "R "+v); }},
  dyn:{th:"ช่วงไดนามิก", min:0, max:150, step:1, unit:"%", fmt:function(v){ return v+"%"; }},
  curve:{th:"โค้งน้ำหนัก", min:-100, max:100, step:1, fmt:function(v){ return v===0 ? "ตรง" : (v<0 ? "เบา "+(-v) : "แรง "+v); }},
  ghost:{th:"ชั้นเบา (โกสต์)", min:-30, max:6, step:0.5, unit:"dB", fmt:db1},
  accent:{th:"ชั้นเน้น", min:-6, max:12, step:0.5, unit:"dB", fmt:db1},
  atk:{th:"หัวเสียง", min:-18, max:12, step:0.5, unit:"dB", fmt:db1},
  body:{th:"ตัวเสียง", min:-30, max:12, step:0.5, unit:"dB", fmt:db1},
  len:{th:"ความยาวเสียง", min:5, max:100, step:1, unit:"%", fmt:function(v){ return v>=100 ? "เต็ม" : v+"%"; }},
  hp:{th:"ตัดทุ้ม (HPF)", min:20, max:2000, log:true, step:1, unit:"Hz", fmt:function(v){ return v<=20.5 ? "ปิด" : hz(v); }},
  lsG:{th:"ทุ้ม", min:-18, max:18, step:0.1, unit:"dB", fmt:db1},
  lsF:{th:"· ความถี่", min:30, max:600, log:true, step:1, fmt:hz},
  pkG:{th:"กลาง", min:-18, max:18, step:0.1, unit:"dB", fmt:db1},
  pkF:{th:"· ความถี่", min:100, max:12000, log:true, step:1, fmt:hz},
  pkQ:{th:"· ความกว้าง Q", min:0.3, max:8, log:true, step:0.01, fmt:function(v){ return v.toFixed(2); }},
  hsG:{th:"แหลม", min:-18, max:18, step:0.1, unit:"dB", fmt:db1},
  hsF:{th:"· ความถี่", min:1500, max:16000, log:true, step:1, fmt:hz},
  lp:{th:"ตัดแหลม (LPF)", min:1000, max:20000, log:true, step:1, fmt:function(v){ return v>=19990 ? "ปิด" : hz(v); }},
  cThr:{th:"เริ่มกดที่", min:-50, max:0, step:0.5, unit:"dB", fmt:db1},
  cRat:{th:"อัตรากด", min:1, max:20, step:0.1, fmt:function(v){ return v.toFixed(1)+":1"; }},
  cAtk:{th:"จับเร็ว", min:0.1, max:100, log:true, step:0.1, fmt:function(v){ return v<10 ? v.toFixed(1)+" ms" : Math.round(v)+" ms"; }},
  cRel:{th:"ปล่อย", min:10, max:1000, log:true, step:1, fmt:function(v){ return Math.round(v)+" ms"; }},
  cMk:{th:"ชดเชยความดัง", min:0, max:24, step:0.1, unit:"dB", fmt:db1},
  sat:{th:"ความแรง", min:0, max:100, step:1, fmt:function(v){ return v ? v+"%" : "ปิด"; }},
  room:{th:"ส่งเข้าห้อง", min:0, max:200, step:1, fmt:function(v){ return v+"%"; }},
  gRoom:{th:"ห้องทั้งชุด", min:0, max:200, step:1, fmt:function(v){ return v+"%"; }},
  gSize:{th:"ขนาดห้อง", min:30, max:300, step:1, fmt:function(v){ return v+"%"; }},
  art:{th:"ระดับ", min:-24, max:12, step:0.1, unit:"dB", fmt:db1}
};
function db1(v){ return (v>0?"+":"")+v.toFixed(1)+" dB"; }
function hz(v){ return v>=1000 ? (v/1000).toFixed(v>=10000?1:2)+" kHz" : Math.round(v)+" Hz"; }
function toPos(d, v){ if(!d.log) return v; return Math.log(v/d.min)/Math.log(d.max/d.min)*1000; }
function fromPos(d, x){ if(!d.log) return +x; var v=d.min*Math.pow(d.max/d.min, x/1000); return d.step>=1 ? Math.round(v) : Math.round(v/d.step)*d.step; }
function q(v, d){ var s=d.step; v=Math.round(v/s)*s; v=Math.max(d.min, Math.min(d.max, v)); return +v.toFixed(4); }

function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
function row(id, d, aria){
  var rmin = d.log ? 0 : d.min, rmax = d.log ? 1000 : d.max, rstep = d.log ? 1 : d.step;
  return '<div class="kfx-row" data-k="'+id+'"><label for="kfxr-'+id+'">'+esc(d.th)+(d.unit && d.unit!=="dB" && d.unit!=="%" ? ' <span style="font-size:11px">('+d.unit+')</span>' : '')+'</label>'+
    '<input type="range" id="kfxr-'+id+'" min="'+rmin+'" max="'+rmax+'" step="'+rstep+'" aria-label="'+esc(aria||d.th)+'">'+
    '<button type="button" class="kfx-v" title="แตะเพื่อพิมพ์ค่า · แตะสองครั้งคืนค่าเดิม"></button>'+
    '<span class="kfx-nud"><button type="button" data-d="-1" aria-label="ลด '+esc(d.th)+'">−</button><button type="button" data-d="1" aria-label="เพิ่ม '+esc(d.th)+'">+</button></span></div>';
}
var cssDone=false;
function ensureCss(){ if(cssDone) return; cssDone=true; var st=document.createElement("style"); st.textContent=CSS; document.head.appendChild(st); }
function build(){
  ensureCss();
  var el=document.createElement("div"); el.id="kfx"; el.hidden=true; el.setAttribute("role","dialog"); el.setAttribute("aria-label","แต่งเสียงกลองรายใบ");
  var kits=(SND() ? SND().kits : []).map(function(k){ return '<button type="button" data-kit="'+k.id+'" aria-pressed="false">'+esc(k.th)+'</button>'; }).join("");
  el.innerHTML=
   '<div class="kfx-wrap">'+
    '<div class="kfx-head"><button class="btn" id="kfxBack" type="button">‹ กลับไปถอดโน้ต</button><h1>แต่งเสียงกลอง</h1>'+
     '<div class="seg kfx-kits" id="kfxKits" role="group" aria-label="ชุดเสียงกลอง">'+kits+'</div><span class="kfx-sp"></span>'+
     '<button class="btn primary" id="kfxPlay" type="button">เล่นเพลง</button><button class="btn" id="kfxResetAll" type="button">รีเซ็ตทั้งชุด</button></div>'+
    '<p class="hint" style="margin:0;font-size:12.5px;color:var(--dim)" id="kfxKitNote"></p>'+
    '<section class="kfx-pre" id="kfxPre" aria-label="ชุดของฉัน"></section>'+
    '<div class="kfx-body"><div class="kfx-pads" id="kfxPads" role="group" aria-label="เลือกใบกลอง">'+
     PIECES.map(function(p){ return '<button type="button" class="kfx-pad" data-p="'+p.id+'" aria-pressed="false"><span class="dot" style="background:'+p.color+'"></span><span class="nm">'+esc(p.th)+'</span><span class="ed"></span></button>'; }).join("")+
    '</div><div class="kfx-ed" id="kfxEd"></div></div></div>';
  document.body.appendChild(el);
  UI={el:el, ed:el.querySelector("#kfxEd")};
  el.querySelector("#kfxBack").onclick=function(){ open(false); };
  el.querySelector("#kfxPlay").onclick=function(){ var b=document.getElementById("play"); if(b) b.click(); setTimeout(syncPlay, 60); };
  el.querySelector("#kfxResetAll").onclick=function(){
    if(!confirm("คืนค่าเสียงทุกใบของชุดนี้ (และห้องทั้งชุด) เป็นค่าเดิม?")) return;
    resetKit(); render();
  };
  el.querySelector("#kfxKits").addEventListener("click", function(e){
    var b=e.target.closest("button[data-kit]"); if(!b || !SND()) return;
    SND().setKit(b.dataset.kit); vcache={}; applyAll(); render();
  });
  el.querySelector("#kfxPads").addEventListener("click", function(e){
    var b=e.target.closest(".kfx-pad"); if(!b) return;
    sel=b.dataset.p; render(); audition(pieceInfo(sel).keys[0]);
  });
  document.addEventListener("keydown", function(e){ if(e.key==="Escape" && !el.hidden) open(false); });
  if(SND()) SND().onChange(function(){ if(!el.hidden){ vcache={}; applyAll(); renderHead(); renderPre(); } });
  psubs.push(function(){ if(!el.hidden) renderPre(); });
  subs.push(function(){ if(!el.hidden) renderPreStatus(); });
  var pb=document.getElementById("play");
  if(pb && window.MutationObserver) new MutationObserver(syncPlay).observe(pb, {childList:true, characterData:true, subtree:true});
}
function syncPlay(){
  if(!UI) return; var pb=document.getElementById("play"), b=UI.el.querySelector("#kfxPlay");
  if(pb && b) b.textContent = /พัก/.test(pb.textContent) ? "พักเพลง" : "เล่นเพลง";
}
/* ป้าย "แก้แล้ว" ที่ปุ่มใบกลอง — อัปเดตทุกครั้งที่ค่าเปลี่ยน ผู้ใช้เห็นว่าใบไหนแต่งไว้บ้าง */
function renderPads(){
  if(!UI) return; var k=curKit();
  UI.el.querySelectorAll(".kfx-pad").forEach(function(b){
    b.setAttribute("aria-pressed", String(b.dataset.p===sel));
    b.querySelector(".ed").textContent = edited(k, b.dataset.p) ? (P(k, b.dataset.p).by ? "เสียงเดิม" : "แก้แล้ว") : "";
  });
}
function renderHead(){
  var k=curKit(), s=SND();
  UI.el.querySelectorAll("#kfxKits button").forEach(function(b){ b.setAttribute("aria-pressed", String(b.dataset.kit===k)); });
  renderPads();
  var st=s ? s.state() : null, info=s ? s.kits.filter(function(x){ return x.id===k; })[0] : null;
  var note = !st ? "" : st.synth ? "ชุดสังเคราะห์: สร้างเสียงในเครื่อง — แหล่งเสียงเปลี่ยนไม่ได้ ที่เหลือปรับได้ทั้งหมด"
    : !st.ready ? "กำลังโหลดเสียงชุดนี้ "+st.loaded+"/"+(st.total||"…")
    : (info ? info.note : "")+" · ค่าที่แต่งจำแยกต่อชุด (ชุดอื่นไม่เปลี่ยน)";
  UI.el.querySelector("#kfxKitNote").textContent=note;
  syncPlay();
}
/* ---------- แถบชุดของฉัน (หน้าแต่งเสียง) ---------- */
var preEdit=null;                        // {i, rename} ระหว่างพิมพ์ชื่อ
function renderPre(){
  var el=UI && UI.el.querySelector("#kfxPre"); if(!el) return;
  var h='<div class="kfx-pre-h"><b>ชุดของฉัน</b><span class="sub" id="kfxPreSub"></span><span class="kfx-sp" style="flex:1"></span>'+
    '<button type="button" class="btn sm" id="kfxPreExp">สำรองเป็นไฟล์</button>'+
    '<label class="btn sm" style="cursor:pointer">นำเข้าไฟล์<input type="file" id="kfxPreImp" accept=".json,application/json" hidden></label></div>'+
    '<div class="kfx-pre-slots" role="group" aria-label="ชุดของฉัน 5 ช่อง">';
  pre.list.forEach(function(p, i){
    h += p ? '<button type="button" class="kfx-slot" data-i="'+i+'" aria-pressed="false"><span class="n">ชุดที่ '+(i+1)+'</span><span class="t">'+esc(p.name)+'</span><span class="k">'+esc(kitTh(p.kit))+'</span></button>'
           : '<button type="button" class="kfx-slot empty" data-i="'+i+'" aria-pressed="false"><span class="n">ชุดที่ '+(i+1)+'</span><span class="t">+ บันทึกที่นี่</span><span class="k">ว่าง</span></button>';
  });
  h+='</div><div class="kfx-pre-act" id="kfxPreAct"></div>';
  el.innerHTML=h;
  el.querySelectorAll(".kfx-slot").forEach(function(b){ b.onclick=function(){ slotTap(+b.dataset.i); }; });
  el.querySelector("#kfxPreExp").onclick=function(){
    var a=document.createElement("a"); a.href=URL.createObjectURL(presetFile());
    a.download="ชุดกลองของฉัน-"+new Date().toISOString().slice(0,10)+".json"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 30000);
  };
  var imp=el.querySelector("#kfxPreImp");
  imp.onchange=function(){
    var f=imp.files && imp.files[0]; if(!f) return;
    var rd=new FileReader();
    rd.onload=function(){
      try{
        var n=presetImport(String(rd.result), false);
        if(n<0 && confirm("ไฟล์นี้มี "+(-n)+" ชุด แต่ช่องว่างไม่พอ — แทนที่ชุดของฉันทั้ง 5 ช่องด้วยชุดในไฟล์?")) n=presetImport(String(rd.result), true);
        if(n>0) flashMsg("นำเข้า "+n+" ชุดแล้ว"); else if(n===0) flashMsg("ชุดในไฟล์มีอยู่แล้วทุกชุด ไม่ได้เพิ่มซ้ำ");
      }catch(e){ flashMsg("นำเข้าไม่ได้: "+(e && e.message || "ไฟล์ไม่ถูกต้อง"), true); }
    };
    rd.readAsText(f); imp.value="";
  };
  renderPreStatus();
}
var flashT=0, flash=null;
function flashMsg(t, warn){ flash={t:t, warn:!!warn}; clearTimeout(flashT); flashT=setTimeout(function(){ flash=null; renderPreStatus(); }, 4000); renderPreStatus(); }
/* สถานะ + ปุ่มของช่องที่ใช้อยู่ — อัปเดตทุกครั้งที่ค่าเปลี่ยน (ไม่สร้างทั้งแถบใหม่ ช่องพิมพ์ชื่อจะได้ไม่หลุด) */
function renderPreStatus(){
  var el=UI && UI.el.querySelector("#kfxPre"); if(!el || !el.firstChild) return;
  var a=activeIdx(), dirty=a>=0 && !sameAs(pre.list[a]), full=pre.list.every(Boolean);
  el.querySelectorAll(".kfx-slot").forEach(function(b){
    var i=+b.dataset.i; b.setAttribute("aria-pressed", String(i===a || (preEdit && preEdit.i===i)));
    var k=b.querySelector(".k"), p=pre.list[i];
    if(p){ k.textContent=kitTh(p.kit)+(i===a && dirty ? " · แก้แล้วยังไม่บันทึก" : ""); k.classList.toggle("dirty", i===a && dirty); }
  });
  var sub=el.querySelector("#kfxPreSub");
  sub.textContent = persisted===true ? "บันทึกค่าที่แต่งทั้งชุดได้ 5 ชุด · เก็บถาวรในเครื่องแล้ว อยู่จนกว่าจะลบเอง"
    : "บันทึกค่าที่แต่งทั้งชุดได้ 5 ชุด · อยู่จนกว่าจะลบเอง (สำรองเป็นไฟล์ไว้ด้วยก็ได้ ย้ายเครื่องได้)";
  var act=el.querySelector("#kfxPreAct"), h="";
  if(preEdit){
    var dv = preEdit.rename ? pre.list[preEdit.i].name : "ชุดที่ "+(preEdit.i+1)+" · "+kitTh(curKit());
    if(!act.querySelector("#kfxPreName")){
      act.innerHTML='<input type="text" id="kfxPreName" maxlength="40" aria-label="ชื่อชุด" value="'+esc(dv)+'">'+
        '<button type="button" class="btn primary" id="kfxPreOk">'+(preEdit.rename ? "เปลี่ยนชื่อ" : "บันทึกชุดนี้")+'</button><button type="button" class="btn" id="kfxPreNo">ยกเลิก</button>';
      var inp=act.querySelector("#kfxPreName"), ok=function(){
        var e=preEdit; preEdit=null;
        if(e.rename) presetRename(e.i, inp.value); else { presetSave(e.i, inp.value); flashMsg("บันทึกเป็น \""+pre.list[e.i].name+"\" แล้ว"); }
        renderPre();
      };
      act.querySelector("#kfxPreOk").onclick=ok;
      act.querySelector("#kfxPreNo").onclick=function(){ preEdit=null; renderPre(); };
      inp.addEventListener("keydown", function(e){ if(e.key==="Enter") ok(); else if(e.key==="Escape"){ preEdit=null; renderPre(); } });
      setTimeout(function(){ try{ inp.focus(); inp.select(); }catch(e){} }, 30);
    }
    return;
  }
  if(flash) h+='<span class="msg'+(flash.warn?" warn":"")+'">'+esc(flash.t)+'</span>';
  else if(preWarn) h+='<span class="msg warn">'+esc(preWarn)+'</span>';
  else if(a>=0) h+='<span class="msg">ใช้ "'+esc(pre.list[a].name)+'" อยู่'+(dirty ? ' · มีค่าที่แก้หลังบันทึก' : ' · ตรงกับที่บันทึกไว้')+'</span>';
  else h+='<span class="msg">'+(full ? "ครบ 5 ชุดแล้ว — แตะชุดเพื่อเรียกใช้ แล้วบันทึกทับ หรือลบชุดที่ไม่ใช้" : "แตะช่องว่างเพื่อบันทึกค่าที่แต่งตอนนี้ · แตะชุดที่บันทึกไว้เพื่อเรียกใช้")+'</span>';
  if(a>=0) h+='<button type="button" class="btn'+(dirty?" primary":"")+'" id="kfxPreSave"'+(dirty?"":" disabled")+'>บันทึกทับ</button>'+
    '<button type="button" class="btn" id="kfxPreRen">เปลี่ยนชื่อ</button><button type="button" class="btn" id="kfxPreDel">ลบชุดนี้</button>';
  act.innerHTML=h;
  if(a>=0){
    act.querySelector("#kfxPreSave").onclick=function(){ presetSave(a, pre.list[a].name); flashMsg("บันทึกทับ \""+pre.list[a].name+"\" แล้ว"); };
    act.querySelector("#kfxPreRen").onclick=function(){ preEdit={i:a, rename:true}; renderPreStatus(); };
    act.querySelector("#kfxPreDel").onclick=function(){
      if(!confirm("ลบชุด \""+pre.list[a].name+"\" ถาวร? (ค่าที่แต่งอยู่ตอนนี้ยังอยู่ ไม่ถูกลบ)")) return;
      presetDel(a); renderPre();
    };
  }
}
function slotTap(i){
  var p=pre.list[i];
  if(!p){ preEdit={i:i, rename:false}; renderPre(); return; }
  if(i===activeIdx()) return;
  if(loses(p) && !confirm('ค่าที่แต่งอยู่ตอนนี้ยังไม่ได้บันทึก — เรียกชุด "'+p.name+'" แทนเลยไหม?\n(ถ้าอยากเก็บไว้ ยกเลิกแล้วบันทึกลงช่องว่างหรือบันทึกทับก่อน)')) return;
  preEdit=null;
  presetLoad(i); render();
  setTimeout(function(){ audition(pieceInfo(sel).keys[0]); }, 200);
}
function render(){
  if(!UI) return;
  renderHead();
  renderPre();
  var k=curKit(), p=P(k, sel), pi=pieceInfo(sel), s=SND(), synth=k==="synth" || !s;
  var h='<div class="kfx-top"><span class="dot" style="width:14px;height:14px;border-radius:50%;background:'+pi.color+'"></span><h2>'+esc(pi.th)+'</h2>'+
    '<span class="kfx-sp" style="flex:1"></span>'+
    '<button type="button" class="btn" id="kfxBy" aria-pressed="'+(p.by?"true":"false")+'" title="ปิดการแต่งของใบนี้ชั่วคราว เทียบกับเสียงเดิม">ฟังเสียงเดิม (A/B)</button>'+
    '<button type="button" class="btn" id="kfxReset">รีเซ็ตใบนี้</button></div>';
  h+='<div class="kfx-test"><span class="lbl">ลองตี</span>'+pi.keys.map(function(key){ return '<button type="button" class="btn kfx-hitb" data-key="'+key+'">'+esc(ART_TH[key]||key)+'</button>'; }).join("")+
    '<span class="lbl" style="margin-left:6px">น้ำหนัก</span><div class="seg" id="kfxVel">'+
    [[42,"เบา"],[100,"ปกติ"],[118,"เน้น"]].map(function(x){ return '<button type="button" data-v="'+x[0]+'" aria-pressed="'+(testVel===x[0])+'">'+x[1]+'</button>'; }).join("")+
    '</div><label class="chk" title="ตีซ้ำทุกจังหวะตามความเร็วเพลง ระหว่างหมุนค่า"><input type="checkbox" id="kfxLoop"'+(loopOn?" checked":"")+'> ตีวนระหว่างปรับ</label></div>';
  h+='<div class="kfx-cards">';
  // แหล่งเสียง + ระดับของท่า
  h+='<section class="kfx-card"><h3>แหล่งเสียง · ระดับแต่ละท่า</h3>';
  if(synth) h+='<p class="note">ชุดสังเคราะห์ไม่มีไฟล์เสียง — เลือกชุดเสียงจริงด้านบนถ้าต้องการเปลี่ยนแหล่งเสียงของใบนี้</p>';
  else {
    var mainOpts=s.sources(pi.keys[0]);
    h+='<div class="kfx-sel"><label for="kfxSrc">'+(pi.keys.length>1 ? esc(ART_TH[pi.keys[0]]) : "เสียงจาก")+'</label><select id="kfxSrc">'+mainOpts.map(function(o){ return '<option value="'+esc(o.id)+'"'+(o.id===p.src?" selected":"")+'>'+esc(o.th)+'</option>'; }).join("")+'</select></div>';
  }
  pi.keys.forEach(function(key, i){
    if(i===0 && pi.keys.length===1) return;
    if(i>0 && !synth){
      var opts=s.sources(key), a=p.art[key]||ADEF;
      var own = pieceSrcFor(key, p.src);
      if(opts.length>1) h+='<div class="kfx-sel"><label for="kfxSrc-'+key+'">'+esc(ART_TH[key])+'</label><select id="kfxSrc-'+key+'" data-art="'+key+'">'+
        opts.map(function(o){ var lab = o.id==="" && own ? "ตามใบ ("+(opts.filter(function(x){ return x.id===own; })[0]||{th:own}).th+")" : o.th;
          return '<option value="'+esc(o.id)+'"'+(o.id===(a.src||"")?" selected":"")+'>'+esc(lab)+'</option>'; }).join("")+'</select></div>';
    }
    h+=row("art-"+key, Object.assign({}, PARAMS.art, {th:"ระดับ"+(ART_TH[key]||"")}));
  });
  if(sel==="snare") h+='<p class="kfx-cr">ครอสสติ๊ก: Risen 6×14 maple (studio501) · Ludwig Black Beauty (pjcohen) · ริมช็อต: Ludwig Black Beauty · VSCO 2 CE (Versilian Studios) — Freesound CC0</p>';
  h+='</section>';
  h+='<section class="kfx-card"><h3>จูน · ระดับ · แพน</h3>'+row("tune", PARAMS.tune)+row("vol", PARAMS.vol)+row("pan", PARAMS.pan)+
    '<p class="note">จูนแบบกลองจริง: เสียงสูงขึ้นแล้วสั้นลง ต่ำลงแล้วยาวขึ้น · คำนวณใหม่คุณภาพสูงทุกไฟล์ (ไม่เพี้ยนแบบเร่งเทป)</p></section>';
  h+='<section class="kfx-card"><h3>น้ำหนักการตี</h3><canvas id="kfxVelG" data-h="96" height="96"></canvas>'+row("curve", PARAMS.curve)+row("dyn", PARAMS.dyn)+row("ghost", PARAMS.ghost)+row("accent", PARAMS.accent)+
    '<p class="note">โค้ง "เบา" = ตีเบาก็ได้เสียงดัง · "แรง" = ต้องตีแรงถึงดัง · ช่วงไดนามิก 0% = ทุกการตีดังเท่ากัน</p></section>';
  h+='<section class="kfx-card"><h3>หัว–หางเสียง</h3><canvas id="kfxEnvG" data-h="96" height="96"></canvas>'+row("atk", PARAMS.atk)+row("body", PARAMS.body)+row("len", PARAMS.len)+
    '<p class="note">หัวเสียง = 6 ms แรก (ความคมตอนไม้กระทบ) · ตัวเสียง = ส่วนที่ก้องต่อ · ความยาว = ตัดหางเสียง (ทอม/กระเดื่องก้องน้อยลง)</p></section>';
  h+='<section class="kfx-card"><h3>EQ</h3><canvas id="kfxEqG" data-h="110" height="110"></canvas>'+row("hp", PARAMS.hp)+row("lsG", PARAMS.lsG)+row("lsF", PARAMS.lsF)+row("pkG", PARAMS.pkG)+row("pkF", PARAMS.pkF)+row("pkQ", PARAMS.pkQ)+row("hsG", PARAMS.hsG)+row("hsF", PARAMS.hsF)+row("lp", PARAMS.lp)+'</section>';
  h+='<section class="kfx-card"><h3>คอมเพรสเซอร์ <span class="sp"></span><label class="chk"><input type="checkbox" id="kfxCmp"'+(p.cmp?" checked":"")+'> เปิด</label></h3>'+row("cThr", PARAMS.cThr)+row("cRat", PARAMS.cRat)+row("cAtk", PARAMS.cAtk)+row("cRel", PARAMS.cRel)+row("cMk", PARAMS.cMk)+
    '<p class="note">ตัวกดเสียงของเว็บมองล่วงหน้า ~6 ms — แอปเลื่อนการตีของใบนี้ขึ้นก่อนเท่ากันให้ยังตรงกริด</p></section>';
  h+='<section class="kfx-card"><h3>แซต (ความอุ่น/แตกนุ่ม)</h3>'+row("sat", PARAMS.sat)+'<p class="note">เติมฮาร์โมนิกแบบเทป/หลอด (oversample 4 เท่า ไม่มีเสียงแตกหยาบ) ชดเชยความดังให้แล้ว</p></section>';
  h+='<section class="kfx-card"><h3>ห้อง (รีเวิร์บ)</h3>'+row("room", PARAMS.room)+'<p class="kfx-sub">ทั้งชุด</p>'+row("gRoom", PARAMS.gRoom)+row("gSize", PARAMS.gSize)+'</section>';
  h+='</div>';
  UI.ed.innerHTML=h;
  wire();
  draw();
}
var loopOn=false, loopT=0, loopKey="";
function audition(key, vel){
  if(window.previewHitKfx) return window.previewHitKfx(key, vel==null ? testVel : vel);
}
function loopTick(){
  clearTimeout(loopT);
  if(!loopOn || !UI || UI.el.hidden) return;
  audition(loopKey || pieceInfo(sel).keys[0]);
  var bpm=(window.KlongBpm && window.KlongBpm()) || 100;
  loopT=setTimeout(loopTick, Math.max(180, 60000/bpm));
}
/* ชุดสเตอริโอ (อะคูสติก): ภาพซ้าย–ขวามาจากไมค์ ค่าเริ่มต้นคือไม่เลื่อน · ชุดโมโน: ตำแหน่งแบบมุมคนตีของชุด */
function stereoSel(){ var s=SND(); if(!s) return false; var x=s.sample(pieceInfo(sel).keys[0], 100); return !!(x && x.buf.numberOfChannels>1); }
function panDef(){ if(stereoSel()) return 0; var m=SND() && SND().map[pieceInfo(sel).keys[0]]; return m ? Math.round(m.pan*100) : 0; }
function valOf(k){
  var p=P(curKit(), sel), g=G();
  if(k==="gRoom") return g.room; if(k==="gSize") return g.size;
  if(k.indexOf("art-")===0){ var a=p.art[k.slice(4)]; return a ? a.db : 0; }
  if(k==="pan") return p.pan!=null ? p.pan : panDef();
  return p[k];
}
function defOf(k){
  if(k==="gRoom") return GDEF.room; if(k==="gSize") return GDEF.size;
  if(k.indexOf("art-")===0) return 0;
  if(k==="pan") return panDef();
  return DEF[k];
}
function descOf(k){ return k.indexOf("art-")===0 ? PARAMS.art : PARAMS[k]; }
function setVal(k, v){ setVal0(k, v); renderPads(); }
function setVal0(k, v){
  if(k==="gRoom") return setG("room", v);
  if(k==="gSize") return setG("size", v);
  if(k.indexOf("art-")===0) return setArt(sel, k.slice(4), "db", v);
  if(k==="pan"){                                            // เท่าตำแหน่งเดิมของชุด = ไม่ได้ตั้ง (ชุดสเตอริโอใช้ภาพเสียงจากไมค์)
    var K=store.kits[curKit()] || (store.kits[curKit()]={}), r=K[sel] || (K[sel]={});
    if(v===defOf("pan")) delete r.pan; else r.pan=v;
    return changed(sel);
  }
  setP(sel, k, v);
}
function showRow(r){
  var k=r.dataset.k, d=descOf(k), v=valOf(k), rg=r.querySelector("input[type=range]"), vb=r.querySelector(".kfx-v");
  rg.value=String(toPos(d, v)); vb.textContent=d.fmt(v);
  vb.classList.toggle("mod", Math.abs(v-defOf(k))>1e-9);
}
function wire(){
  var ed=UI.ed;
  ed.querySelectorAll(".kfx-row").forEach(function(r){
    var k=r.dataset.k, d=descOf(k), rg=r.querySelector("input[type=range]"), vb=r.querySelector(".kfx-v");
    showRow(r);
    rg.addEventListener("input", function(){ setVal(k, q(fromPos(d, +rg.value), d)); showRow(r); draw(); });
    // แตะค่า = พิมพ์ · แตะสองครั้ง = คืนค่าเดิม
    var tapT=0;
    vb.addEventListener("click", function(){
      if(tapT){ clearTimeout(tapT); tapT=0; setVal(k, defOf(k)); showRow(r); draw(); return; }   // แตะสองครั้ง = ค่าเดิม
      tapT=setTimeout(function(){
        tapT=0;
        var inp=document.createElement("input"); inp.type="text"; inp.inputMode="decimal"; inp.className="kfx-in";
        var sc=d.scale||1, v0=valOf(k); inp.value=String(+(v0/sc).toFixed(3));
        inp.setAttribute("aria-label", d.th+(d.unit ? " ("+d.unit+")" : ""));
        vb.hidden=true; vb.after(inp); inp.focus(); inp.select();
        var fin=false, done=function(ok){
          if(fin) return; fin=true;
          if(ok){ var n=parseFloat(String(inp.value).replace(",", ".").replace(/[^0-9.+-]/g, "")); if(isFinite(n)) setVal(k, q(n*sc, d)); }
          inp.remove(); vb.hidden=false; showRow(r); draw();
        };
        inp.addEventListener("keydown", function(e){ if(e.key==="Enter") done(true); else if(e.key==="Escape") done(false); });
        inp.addEventListener("blur", function(){ done(true); });
      }, 300);
    });
    r.querySelectorAll(".kfx-nud button").forEach(function(b){
      var dir=+b.dataset.d, rep=0, t0=0, n=0;
      var step=function(){                                    // กดค้าง: ทีละขั้นละเอียด แล้วเร่งเป็น 10 ขั้นหลัง ~1 วินาที
        var v=valOf(k), s=d.log ? Math.max(d.step, v*0.01) : d.step;
        if(++n>18) s*=10;
        setVal(k, q(v+dir*s, d)); showRow(r); draw();
      };
      var stopRep=function(){ clearTimeout(t0); clearInterval(rep); rep=0; n=0; };
      b.addEventListener("pointerdown", function(e){ e.preventDefault(); stopRep(); step(); t0=setTimeout(function(){ rep=setInterval(step, 55); }, 380); });
      ["pointerup","pointerleave","pointercancel"].forEach(function(ev){ b.addEventListener(ev, stopRep); });
      b.addEventListener("click", function(e){ e.preventDefault(); });
    });
  });
  var src=ed.querySelector("#kfxSrc");
  if(src) src.onchange=function(){ setP(sel, "src", src.value); setTimeout(function(){ audition(pieceInfo(sel).keys[0]); }, 250); render(); };
  ed.querySelectorAll("select[data-art]").forEach(function(sl){
    sl.onchange=function(){ setArt(sel, sl.dataset.art, "src", sl.value); setTimeout(function(){ audition(sl.dataset.art); }, 250); render(); };
  });
  var by=ed.querySelector("#kfxBy");
  by.onclick=function(){ setP(sel, "by", P(curKit(), sel).by ? 0 : 1); render(); audition(loopKey || pieceInfo(sel).keys[0]); };
  ed.querySelector("#kfxReset").onclick=function(){ resetPiece(sel); render(); };
  var cmp=ed.querySelector("#kfxCmp"); cmp.onchange=function(){ setP(sel, "cmp", cmp.checked ? 1 : 0); renderPads(); };
  ed.querySelectorAll(".kfx-hitb").forEach(function(b){ b.onclick=function(){ loopKey=b.dataset.key; audition(b.dataset.key); }; });
  ed.querySelector("#kfxVel").addEventListener("click", function(e){
    var b=e.target.closest("button[data-v]"); if(!b) return; testVel=+b.dataset.v;
    ed.querySelectorAll("#kfxVel button").forEach(function(x){ x.setAttribute("aria-pressed", String(x===b)); });
    audition(loopKey || pieceInfo(sel).keys[0]); draw();
  });
  var lp=ed.querySelector("#kfxLoop"); lp.onchange=function(){ loopOn=lp.checked; loopTick(); };
}

/* ---------- กราฟ (สีต้องอยู่ใน MAP ของธีม) ---------- */
function cv(id){
  var c=UI.ed.querySelector("#"+id); if(!c) return null;
  var dpr=Math.min(2, window.devicePixelRatio||1), w=Math.max(200, c.clientWidth||300), h=+c.getAttribute("data-h")||96;
  if(c.width!==Math.round(w*dpr) || c.height!==Math.round(h*dpr)){ c.width=Math.round(w*dpr); c.height=Math.round(h*dpr); c.style.height=h+"px"; }
  var g=c.getContext("2d"); g.setTransform(dpr,0,0,dpr,0,0);
  g.fillStyle="#1f1b19"; g.fillRect(0,0,w,h);
  g.font="10.5px 'IBM Plex Sans Thai', sans-serif"; g.textBaseline="middle";
  return {g:g, w:w, h:h};
}
var drawQ=0;
function draw(){ if(drawQ) return; drawQ=requestAnimationFrame(function(){ drawQ=0; try{ drawVel(); drawEnv(); drawEq(); }catch(e){} }); }
function drawVel(){
  var o=cv("kfxVelG"); if(!o) return; var g=o.g, w=o.w, h=o.h, p=P(curKit(), sel);
  var fx={cexp:Math.pow(2, p.curve/100)}, L=28, R=8, T=8, B=16, lo=-36, hi=6;
  var X=function(v){ return L+(v-1)/126*(w-L-R); }, Y=function(db){ return T+(hi-db)/(hi-lo)*(h-T-B); };
  g.strokeStyle="#3a322d"; g.lineWidth=1;
  [0,-12,-24].forEach(function(db){ g.beginPath(); g.moveTo(L, Y(db)+0.5); g.lineTo(w-R, Y(db)+0.5); g.stroke(); g.fillStyle="#9c8b82"; g.fillText((db>0?"+":"")+db, 4, Y(db)); });
  // ช่วงชั้นเสียง (ตามน้ำหนักที่ผ่านโค้งแล้ว)
  g.fillStyle="rgba(127,184,194,0.14)";
  var inv=function(t){ return 127*Math.pow(t/127, 1/fx.cexp); };
  g.fillRect(X(inv(55)), T, X(inv(110))-X(inv(55)), h-T-B);
  g.fillStyle="#9c8b82"; g.fillText("เบา", X(1)+4, h-7); g.fillText("ปกติ", X(inv(55))+4, h-7); g.fillText("เน้น", Math.min(w-R-22, X(inv(110))+4), h-7);
  g.strokeStyle="#e8a447"; g.lineWidth=2; g.beginPath();
  for(var v=1; v<=127; v++){
    var vc=curve(v, fx), Lr = vc<55 ? "ghost" : vc>=110 ? "accent" : "normal", nom={ghost:42, normal:100, accent:118}[Lr];
    var f=Math.max(0.45, Math.min(1.2, vc/nom)), db=((Lr==="ghost" ? p.ghost : Lr==="accent" ? p.accent : 0) + 20*Math.log10(f))*p.dyn/100;
    if(v===1) g.moveTo(X(v), Y(db)); else g.lineTo(X(v), Y(db));
  }
  g.stroke();
  g.strokeStyle="#7fb8c2"; g.lineWidth=1; g.beginPath(); g.moveTo(X(testVel)+0.5, T); g.lineTo(X(testVel)+0.5, h-B); g.stroke();
}
function drawEnv(){
  var o=cv("kfxEnvG"); if(!o) return; var g=o.g, w=o.w, h=o.h, p=P(curKit(), sel);
  var key=loopKey && pieceOf(loopKey)===sel ? loopKey : pieceInfo(sel).keys[0];
  var smp=SND() ? SND().sample(key, testVel) : null, mid=h/2, L=6, R=6;
  var rate=Math.pow(2, p.tune/1200);
  var dur = smp ? (smp.buf.duration-smp.off)/rate : 0.8, span=Math.max(0.25, Math.min(2.5, dur));
  var X=function(t){ return L+t/span*(w-L-R); };
  g.strokeStyle="#3a322d"; g.lineWidth=1; g.beginPath(); g.moveTo(L, mid+0.5); g.lineTo(w-R, mid+0.5); g.stroke();
  var fx={atk:p.atk, body:p.body, len:p.len/100};
  var A=dbg(p.atk), Bv=dbg(p.body), len=p.len/100, Ld=Math.max(0.02, dur*len), fadeT=len<0.999 ? Math.max(0.03, Ld*0.55) : null, tau=Math.max(0.004, Ld*0.15);
  var envAt=function(t){ if(t<=0.006) return A; if(t<0.03) return A+(Bv-A)*(t-0.006)/0.024; if(fadeT!=null && t>fadeT) return Bv*Math.exp(-(t-fadeT)/tau); return Bv; };
  if(smp){
    var d=smp.buf.getChannelData(0), sr=smp.buf.sampleRate, i0=Math.round(smp.off*sr), n=w-L-R, pk=1e-6, cols=[];
    for(var x=0;x<n;x++){
      var t0=x/n*span*rate, t1=(x+1)/n*span*rate, a=Math.floor(i0+t0*sr), b=Math.min(d.length, Math.floor(i0+t1*sr)), m=0;
      for(var i=a;i<b;i++){ var v=d[i]<0?-d[i]:d[i]; if(v>m) m=v; }
      cols.push(m); if(m>pk) pk=m;
    }
    var sc=(mid-8)/pk;
    g.fillStyle="#5a4e46";
    for(x=0;x<n;x++){ var hh=Math.max(0.5, cols[x]*sc); g.fillRect(L+x, mid-hh, 1, hh*2); }
    g.fillStyle="#8a7469";
    for(x=0;x<n;x++){ var e=envAt(x/n*span); var hh2=Math.max(0.5, Math.min(mid-2, cols[x]*sc*e)); g.fillRect(L+x, mid-hh2, 1, hh2*2); }
  } else { g.fillStyle="#9c8b82"; g.fillText("ชุดสังเคราะห์ / ยังโหลดเสียงไม่เสร็จ — เส้นคือหัว–หางเสียงที่ตั้งไว้", L+4, 12); }
  g.strokeStyle="#e8a447"; g.lineWidth=1.6; g.beginPath();
  var top=function(e){ return mid-Math.min(1.6, e)*(mid-8)/1.6*1.0; };
  for(var xx=0; xx<=w-L-R; xx+=2){ var t=xx/(w-L-R)*span, ev=envAt(t); if(xx===0) g.moveTo(L+xx, top(ev)); else g.lineTo(L+xx, top(ev)); }
  g.stroke();
  g.fillStyle="#9c8b82"; g.fillText(Math.round(span*1000)+" ms", w-R-44, h-8);
}
var eqCtx=null, eqN=null;
function drawEq(){
  var o=cv("kfxEqG"); if(!o) return; var g=o.g, w=o.w, h=o.h, p=P(curKit(), sel);
  var O=window.OfflineAudioContext||window.webkitOfflineAudioContext;
  if(!eqCtx){ eqCtx=new O(1, 128, 44100); eqN={hp:eqCtx.createBiquadFilter(), ls:eqCtx.createBiquadFilter(), pk:eqCtx.createBiquadFilter(), hs:eqCtx.createBiquadFilter(), lp:eqCtx.createBiquadFilter()};
    eqN.hp.type="highpass"; eqN.ls.type="lowshelf"; eqN.pk.type="peaking"; eqN.hs.type="highshelf"; eqN.lp.type="lowpass"; eqN.hp.Q.value=eqN.lp.Q.value=0.7071; }
  var on=onOf(p);
  eqN.hp.frequency.value=p.hp; eqN.lp.frequency.value=Math.min(p.lp, 21000);
  eqN.ls.frequency.value=p.lsF; eqN.ls.gain.value=p.lsG; eqN.pk.frequency.value=p.pkF; eqN.pk.gain.value=p.pkG; eqN.pk.Q.value=p.pkQ; eqN.hs.frequency.value=p.hsF; eqN.hs.gain.value=p.hsG;
  var L=30, R=8, T=8, B=16, n=Math.max(64, Math.round(w-L-R)), fr=new Float32Array(n), mag=new Float32Array(n), ph=new Float32Array(n), tot=new Float32Array(n);
  for(var i=0;i<n;i++) fr[i]=20*Math.pow(1000, i/(n-1));
  ["hp","ls","pk","hs","lp"].forEach(function(k){ if(!on[k]) return; eqN[k].getFrequencyResponse(fr, mag, ph); for(var i=0;i<n;i++) tot[i]+=20*Math.log10(Math.max(1e-6, mag[i])); });
  var lo=-24, hi=24, X=function(f){ return L+Math.log(f/20)/Math.log(1000)*(w-L-R); }, Y=function(db){ return T+(hi-Math.max(lo, Math.min(hi, db)))/(hi-lo)*(h-T-B); };
  g.strokeStyle="#3a322d"; g.lineWidth=1;
  [100,1000,10000].forEach(function(f){ g.beginPath(); g.moveTo(X(f)+0.5, T); g.lineTo(X(f)+0.5, h-B); g.stroke(); g.fillStyle="#9c8b82"; g.fillText(f>=1000 ? (f/1000)+"k" : String(f), X(f)+3, h-7); });
  [12,-12].forEach(function(db){ g.beginPath(); g.moveTo(L, Y(db)+0.5); g.lineTo(w-R, Y(db)+0.5); g.stroke(); g.fillStyle="#9c8b82"; g.fillText((db>0?"+":"")+db, 4, Y(db)); });
  g.strokeStyle="#5a4e46"; g.beginPath(); g.moveTo(L, Y(0)+0.5); g.lineTo(w-R, Y(0)+0.5); g.stroke(); g.fillStyle="#9c8b82"; g.fillText("0", 4, Y(0));
  g.fillStyle="rgba(127,184,194,0.14)"; g.beginPath(); g.moveTo(L, Y(0));
  for(i=0;i<n;i++) g.lineTo(L+i, Y(tot[i])); g.lineTo(L+n-1, Y(0)); g.closePath(); g.fill();
  g.strokeStyle="#7fb8c2"; g.lineWidth=2; g.beginPath();
  for(i=0;i<n;i++){ if(i===0) g.moveTo(L, Y(tot[0])); else g.lineTo(L+i, Y(tot[i])); }
  g.stroke();
}

function open(on){
  if(!UI) build();
  UI.el.hidden=!on;
  document.body.classList.toggle("atkfx", !!on);
  if(on){ vcache={}; render(); UI.el.scrollTop=0; measure(44100); }
  else { loopOn=false; clearTimeout(loopT); if(window.KlongRedraw) window.KlongRedraw(); }
}
window.addEventListener("resize", function(){ if(UI && !UI.el.hidden) draw(); });

/* ปุ่มเปิดหน้านี้ใต้ตัวเลือกชุดเสียง (แผงตั้งค่า ส่วนการฟัง — สร้างโดย klong-sounds.js) */
function inject(){
  ensureCss();
  var cr=document.getElementById("kKitCr");
  if(cr && !document.getElementById("kfxOpen")){
    var b=document.createElement("button"); b.type="button"; b.className="btn sm"; b.id="kfxOpen"; b.textContent="แต่งเสียงกลองรายใบ…";
    b.style.alignSelf="flex-start"; b.onclick=function(){ open(true); };
    cr.after(b);
  }
  var to=document.getElementById("toKfx"); if(to) to.onclick=function(){ open(true); };
  var ob=document.getElementById("kfxOpen");
  if(ob && !document.getElementById("kfxQ")){
    var w=document.createElement("div"); w.className="kfx-q"; w.id="kfxQW";
    w.innerHTML='<span class="h">ชุดของฉัน</span><div class="seg" id="kfxQ" role="group" aria-label="เรียกชุดของฉัน"></div>';
    ob.after(w);
    w.addEventListener("click", function(e){
      var b=e.target.closest("button[data-i]"); if(!b) return;
      var i=+b.dataset.i, p=pre.list[i]; if(!p || i===activeIdx()) return;
      if(loses(p) && !confirm('ค่าที่แต่งอยู่ตอนนี้ยังไม่ได้บันทึก — เรียกชุด "'+p.name+'" แทนเลยไหม?')) return;
      presetLoad(i);
      var t=document.getElementById("testSnd"), pb=document.getElementById("play");
      if(t && !(pb && /พัก/.test(pb.textContent))) setTimeout(function(){ t.click(); }, 250);
    });
    psubs.push(quick); subs.push(quick); if(SND()) SND().onChange(quick);
  }
  quick();
}
/* ปุ่มเรียกชุดของฉันในแผงตั้งค่า (ส่วนการฟัง) — สลับชุดได้ระหว่างถอดเพลงโดยไม่ต้องเปิดหน้าแต่งเสียง */
function quick(){
  var w=document.getElementById("kfxQW"), q=document.getElementById("kfxQ"); if(!w || !q) return;
  var a=activeIdx(), any=false, h="";
  pre.list.forEach(function(p, i){ if(!p) return; any=true;
    h+='<button type="button" data-i="'+i+'" aria-pressed="'+(i===a)+'" title="'+esc(p.name)+' · '+esc(kitTh(p.kit))+'">'+esc(p.name)+'</button>'; });
  w.hidden=!any; q.innerHTML=h;
}
function boot(){ inject(); restorePre().then(quick); setTimeout(function(){ inject(); measure(44100); measure(48000); }, 600); }   // วัดความหน่วงไว้ก่อนเล่นครั้งแรก
if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", boot);
else boot();

window.KlongFX={
  pieces:PIECES, pieceOf:pieceOf, voice:voice, cur:cur, curve:curve, env:env, tuned:tuned,
  route:route, cut:cut, input:input, latency:latency, prepare:prepare, warm:warm, hit:hit,
  open:open, onChange:function(f){ subs.push(f); },
  get:function(pid){ return P(curKit(), pid); }, set:function(pid, k, v){ setP(pid, k, v); if(UI && !UI.el.hidden) render(); },
  setArt:function(pid, key, k, v){ setArt(pid, key, k, v); }, reset:function(pid){ pid ? resetPiece(pid) : resetKit(); },
  presets:{list:function(){ return clone(pre.list); }, active:activeIdx, save:presetSave, load:presetLoad, del:presetDel, rename:presetRename,
    file:presetFile, import:presetImport, onChange:function(f){ psubs.push(f); }},
  _groups:groups, _lat:LAT, _resample:resample
};
})();
