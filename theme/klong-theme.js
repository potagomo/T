/* ============================================================
   ธีมมิดเซนจูรี่ของ Klong Pro — กลางวัน / กลางคืน

   ไฟล์นี้แยกจากตัวโปรแกรมโดยตั้งใจ index.html มีแค่บรรทัดที่เรียกไฟล์นี้
   ตัวโปรแกรมของผู้พัฒนาจึงรับรุ่นใหม่ด้วย merge ได้สะอาดเหมือนเดิม

   ทำอะไรบ้าง
   1) แปลงสีบน canvas — โค้ดวาดกริดของโปรแกรมฝังสีไว้ราว 80 จุด แทนที่จะไปแก้
      ทีละจุดกลางโค้ด (ชนตอน merge แน่) เราดักตอนตั้ง fillStyle/strokeStyle
      แล้วแปลงเป็นสีของธีม เฉพาะ canvas ที่อยู่บนหน้าจอเท่านั้น
      canvas ของการส่งออก PDF/รูป ถูกสร้างแยกไว้นอกหน้า (isConnected = false)
      จึงไม่โดนธีม ไฟล์ที่ส่งออกหน้าตาเหมือนเดิมทุกอย่าง
   2) แปลงสีเสียงกลองที่โผล่ใน DOM (จุดสีหน้าชื่อเสียง แผงตีกลอง ฯลฯ) ให้ตรงกับกริด
   3) สวิตช์กลางวัน / กลางคืน / ตามเครื่อง จำไว้ในเครื่อง
   4) ไฟจังหวะ — อ่านจากนาฬิกาบนจอ ไม่แตะตรรกะการเล่น
   5) มาตรวัด — อ่านระดับเสียงจริงที่ออกลำโพง ผ่านจุดแตะสัญญาณที่โปร่งใส 100%
   6) ปุ่มยุบตามนิ้ว/ปากกา และความสูงของแถบบนเมื่อขึ้นสองแถว

   ต้องโหลดใน <head> แบบปกติ (ไม่ defer) เพื่อให้ตั้งโหมดก่อนหน้าแรกวาด
   และติดตั้งตัวแปลงสีก่อนโปรแกรมสร้าง canvas
   ============================================================ */
(function(){
"use strict";
var root=document.documentElement;
var KEY="klong-theme";                 // ค่าที่ผู้ใช้เลือก: day | night | auto
var pref="auto";
try{ var s=localStorage.getItem(KEY); if(s==="day"||s==="night"||s==="auto") pref=s; }catch(e){}
var mq=window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
function sysNight(){ return !!(mq && mq.matches); }
var night = pref==="night" || (pref==="auto" && sysNight());
root.setAttribute("data-kmode", night?"night":"day");

/* ---------- ตารางสี: [กลางวัน, กลางคืน] ----------
   คีย์คือสีที่โค้ดโปรแกรมเขียนไว้ (ตัวเล็ก ไม่มีช่องว่าง)
   สีเสียงกลองอยู่ใน VOICES ของโปรแกรม ไฮแฮตถูกเปลี่ยนเป็น #4FC8D4 ใน index.html
   เพื่อแยกออกจาก #4FC7D4 ที่โปรแกรมใช้เป็นสีของ "ตัวที่เลือก" */
var LANE={
  "#c3d44f":["#C8951A","#E2B54A"],  // แครช
  "#a8c44a":["#B07F12","#D6A73F"],  // แครช 2
  "#8fb03c":["#9A7414","#C99A36"],  // ไชน่า
  "#dce887":["#D9A93A","#EDC86A"],  // สแปลช
  "#e8e06a":["#C9A227","#E8C658"],  // ไรด์เบลล์
  "#cbd45f":["#B5862A","#CDA14B"],  // ไรด์
  "#4fc8d4":["#6F7D27","#93A33F"],  // ไฮแฮตปิด
  "#7fe0ea":["#8E9A34","#B5C25A"],  // ไฮแฮตเปิด
  "#c8a0f0":["#C9612A","#E07F45"],  // ทอม 1
  "#b98be8":["#A9501F","#C8693A"],  // ทอม 2
  "#e2564a":["#A8352A","#D2574A"],  // สแนร์ (เฉพาะ fill — stroke สีนี้คือ "ผิดกฎ")
  "#f07a6a":["#C2493B","#E07A6A"],  // ริมช็อต
  "#c98077":["#9C5A4E","#C98A7E"],  // ครอสสติ๊ก
  "#9a6fd0":["#6E4A66","#A8799B"],  // ฟลอร์ทอม
  "#e8a0c8":["#B0607F","#D98FB0"],  // คาวเบล
  "#f0a02e":["#3B2A20","#D9C3A0"],  // กระเดื่อง
  "#c98b2e":["#7A5A2E","#B99560"]   // ไฮแฮตเท้า
};
var SEL=["#1F7A74","#4FB3A8"], WARN=["#B3261E","#E0614F"];
var INK=["#33241A","#EADBC0"], DIM=["#6B5747","#AE9880"];
var MAP={
  /* เส้นแบ่งย่อยของกริด 2 · 4 · 8 · 16 ช่อง */
  "rgba(104,89,82,.62)":["rgba(120,92,64,.50)","rgba(112,88,66,.62)"],
  "rgba(88,75,69,.46)": ["rgba(120,92,64,.34)","rgba(97,76,57,.46)"],
  "rgba(74,63,58,.34)": ["rgba(120,92,64,.22)","rgba(82,64,48,.34)"],
  "rgba(66,56,52,.26)": ["rgba(120,92,64,.14)","rgba(72,56,42,.26)"],
  "rgba(79,199,212,.09)":["rgba(31,122,116,.11)","rgba(79,179,168,.11)"],   // ห้องที่เลือก
  "rgba(255,255,255,.016)":["rgba(91,58,36,.035)","rgba(255,240,215,.02)"], // แถวสลับ
  "rgba(0,0,0,.28)":["rgba(91,58,36,.13)","rgba(0,0,0,.32)"],              // แถวที่ปิดเสียง
  "rgba(255,255,255,.028)":["rgba(91,58,36,.045)","rgba(255,240,215,.03)"],
  "#7a665d":["#8A6E50","#7A6047"],  // เส้นห้องบนหัวกริด
  "#b9a79d":["#4A3628","#CDBA9C"],  // เลขห้อง
  "#7fb8c2":["#2A6F6A","#7FC4BA"],  // ป้ายรองสีฟ้าอมเขียว
  "#e0a64a":["#A8741A","#E2B54A"],  // อัตราจังหวะ ความเร็ว
  "rgba(127,184,194,.85)":["rgba(42,111,106,.85)","rgba(127,196,186,.85)"],
  "rgba(224,166,74,.85)": ["rgba(168,116,26,.85)","rgba(226,181,74,.85)"],
  "#6e5c53":["#A88F6B","#6E5848"], "#544741":["#C7B391","#4F3E31"],
  "rgba(224,166,74,.50)":["rgba(168,116,26,.45)","rgba(226,181,74,.45)"],
  "rgba(120,190,200,.34)":["rgba(42,111,106,.28)","rgba(127,196,186,.30)"],
  "#453b37":["#CDB993","#3E2F24"],
  "rgba(69,59,55,.45)":["rgba(120,95,70,.25)","rgba(87,67,47,.45)"],
  "#fff9f2":["#33241A","#F5EAD6"],  // ขอบโน้ตที่วางเอง
  "#4fc7d4":SEL,                    // ตัวที่เลือก
  "#fff3e6":SEL,                    // หัวอ่าน (ใน canvas หลักใช้เป็นหมึก ดู OVERRIDE)
  "#d9cec5":["#5B4636","#A8927A"],  // บรรทัด 5 เส้น
  "#9c8b82":DIM, "#efe7de":INK,
  "#6a5a53":["#8A7461","#6F5A48"],  // เส้นน้อย
  "#8a7469":["#8A6E50","#8A7461"],
  "#6f625b":["#B5A486","#5E4C3E"],  // หัวโน้ตของเสียงที่ปิดอยู่
  "#b8ada4":["#7D6A58","#B8A58C"],  // โน้ตประดับ
  "rgba(127,184,194,0.38)":["rgba(31,122,116,.35)","rgba(79,179,168,.38)"],
  /* canvas อื่นบนจอ: แถบคลื่นเสียง ฟิล์มสตริป บรรทัดของแผงตีกลอง */
  "#1f1b19":["#EFE6D2","#1E1611"],
  "#3a322d":["#DCCDAE","#3E2F24"],
  "#d8cfc5":["#4A3628","#D9C7A9"],
  "rgba(232,104,92,0.16)":["rgba(179,38,30,.14)","rgba(224,97,79,.16)"],
  "#e8685c":WARN, "#e8a447":["#A8741A","#E2B54A"],
  "#5a4e46":["#BBA67F","#57432F"],
  "rgba(127,184,194,0.14)":["rgba(31,122,116,.12)","rgba(79,179,168,.14)"],
  "#2e2722":["#E3D5B8","#2E2219"], "#25201c":["#EDE3CD","#241A14"],
  "#f1e9df":INK, "#aa9c91":DIM,
  /* สีของไฟห้องเอง (มาจาก KlongTheme.focus) ผ่านไปตามเดิม */
  "rgba(197,154,78,.16)":["rgba(197,154,78,.16)","rgba(197,154,78,.16)"],
  "rgba(201,161,95,.10)":["rgba(201,161,95,.10)","rgba(201,161,95,.10)"]
};
/* สีเดียวกันแต่ความหมายต่างกันตาม canvas หรือตามว่าเป็น fill / stroke */
var OVERRIDE={
  grid:{ "#1f1b19":["#22170F","#1A120D"],   // ตัวหนังสือบนตัวโน้ต
         "#fff3e6":INK }                    // เส้นโน้ตในกลุ่มที่ไม่ได้เลือก
};
var STROKE={ "#e2564a":WARN };              // ขอบแดง = โน้ตผิดกฎ

function norm(v){
  v=v.trim().toLowerCase().replace(/\s+/g,"");
  if(v.length===4 && v[0]==="#") v="#"+v[1]+v[1]+v[2]+v[2]+v[3]+v[3];
  return v;
}
var unmapped=new Set();
/* สีที่เป็นผลของธีมเองในรูปที่เบราว์เซอร์ปัดแล้ว (เช่น .045 -> 0.043)
   โค้ดบางจุดอ่าน fillStyle กลับไปแล้วตั้งซ้ำ ค่าแบบนี้ไม่ใช่สีหลุด ไม่ต้องจด */
var OUT=new Set();
(function(){
  try{
    var c=document.createElement("canvas").getContext("2d"), all=[];
    [LANE,MAP,STROKE].forEach(function(t){ Object.keys(t).forEach(function(k){ all.push(t[k][0],t[k][1]); }); });
    Object.keys(OVERRIDE).forEach(function(id){ Object.keys(OVERRIDE[id]).forEach(function(k){ all.push(OVERRIDE[id][k][0],OVERRIDE[id][k][1]); }); });
    all.forEach(function(v){ c.fillStyle=v; OUT.add(norm(String(c.fillStyle))); });
  }catch(e){}
})();
function themed(ctx, v, isStroke){
  if(typeof v!=="string") return v;
  var cv=ctx.canvas;
  if(!cv || !cv.isConnected) return v;          // canvas ส่งออก: ไม่แตะ
  var k=norm(v), i=night?1:0, alpha="";
  if(k.length===9 && k[0]==="#"){ alpha=k.slice(7); k=k.slice(0,7); }
  var ov=OVERRIDE[cv.id], hit;
  if(isStroke && STROKE[k]) hit=STROKE[k];
  else if(ov && ov[k]) hit=ov[k];
  else if(LANE[k]) hit=LANE[k];
  else if(MAP[k]) hit=MAP[k];
  if(!hit){ if(k!=="transparent" && !OUT.has(k)) unmapped.add(k); return v; }
  return hit[i]+alpha;
}
function patch(proto, prop, isStroke){
  var d=Object.getOwnPropertyDescriptor(proto, prop);
  if(!d || !d.set) return;
  Object.defineProperty(proto, prop, {
    configurable:true, enumerable:d.enumerable,
    get:function(){ return d.get.call(this); },
    set:function(v){ try{ v=themed(this, v, isStroke); }catch(e){} d.set.call(this, v); }
  });
}
if(window.CanvasRenderingContext2D){
  patch(CanvasRenderingContext2D.prototype, "fillStyle", false);
  patch(CanvasRenderingContext2D.prototype, "strokeStyle", true);
}

/* ---------- สีเสียงกลองที่โผล่ใน DOM ---------- */
var BACK={};                                   // สีธีม -> สีต้นฉบับ ไว้สลับโหมด
Object.keys(LANE).forEach(function(k){ BACK[LANE[k][0].toLowerCase()]=k; BACK[LANE[k][1].toLowerCase()]=k; });
function hex2(n){ return ("0"+(+n).toString(16)).slice(-2); }
var COLOR_RE=/#[0-9a-fA-F]{6}\b|rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g;
function remapStyle(el){
  var st=el.getAttribute("style"); if(!st || st.indexOf("background")<0) return;
  var out=st.replace(COLOR_RE, function(m,r,g,b){
    var h=(r!=null ? "#"+hex2(r)+hex2(g)+hex2(b) : m).toLowerCase();
    var orig=BACK[h]||h;
    return LANE[orig] ? LANE[orig][night?1:0] : m;
  });
  if(out!==st) el.setAttribute("style", out);
}
function remapTree(node){
  if(!node || node.nodeType!==1) return;
  if(node.hasAttribute("style")) remapStyle(node);
  var list=node.querySelectorAll('[style*="background"]');
  for(var i=0;i<list.length;i++) remapStyle(list[i]);
}

/* ---------- สลับโหมด ---------- */
function apply(){
  night = pref==="night" || (pref==="auto" && sysNight());
  root.setAttribute("data-kmode", night?"night":"day");
  var meta=document.querySelector('meta[name="theme-color"]');
  if(meta) meta.setAttribute("content", night?"#2C1C11":"#4E321F");
  if(document.body) remapTree(document.body);
  var btns=document.querySelectorAll("#kMode button");
  for(var i=0;i<btns.length;i++) btns[i].setAttribute("aria-pressed", String(btns[i].dataset.mode===pref));
  try{ window.dispatchEvent(new Event("resize")); }catch(e){}   // ให้โปรแกรมวาดกริดใหม่ด้วยสีใหม่
}
if(mq){ var onSys=function(){ if(pref==="auto") apply(); };
  if(mq.addEventListener) mq.addEventListener("change", onSys); else if(mq.addListener) mq.addListener(onSys); }

/* ---------- มาตรวัด: แตะสัญญาณก่อนออกลำโพง โปร่งใส ไม่เปลี่ยนเสียง ---------- */
var meter=null;   // {an, buf}
if(window.AudioNode && window.AudioContext){
  var origConnect=AudioNode.prototype.connect;
  AudioNode.prototype.connect=function(dest){
    try{
      var ctx=this.context;
      if(dest && ctx && dest===ctx.destination && ctx instanceof AudioContext){
        if(!ctx.__kTap){
          var tap=ctx.createGain(), an=ctx.createAnalyser();
          an.fftSize=1024; an.smoothingTimeConstant=0;
          origConnect.call(tap, ctx.destination); origConnect.call(tap, an);
          ctx.__kTap=tap; meter={an:an, buf:new Float32Array(an.fftSize)};
        }
        var args=Array.prototype.slice.call(arguments); args[0]=ctx.__kTap;
        return origConnect.apply(this, args);
      }
    }catch(e){}
    return origConnect.apply(this, arguments);
  };
}

/* ---------- ส่วนที่ต้องรอ DOM ---------- */
function ready(){
  remapTree(document.body);
  new MutationObserver(function(muts){
    for(var i=0;i<muts.length;i++){
      var m=muts[i];
      if(m.type==="attributes") remapStyle(m.target);
      else for(var j=0;j<m.addedNodes.length;j++) remapTree(m.addedNodes[j]);
    }
  }).observe(document.body, {subtree:true, childList:true, attributes:true, attributeFilter:["style"]});

  /* ปุ่มยุบตามนิ้วและปากกา (ใช้ pointer event เพราะ :active ของ Safari บน iPad ไม่แน่นอน) */
  var KEYS=".btn, .seg button, .valwrap button, #genres button, #tpToggle, .hcard, #kMode button";
  document.addEventListener("pointerdown", function(e){
    var k=e.target.closest && e.target.closest(KEYS);
    if(k && !k.disabled) k.classList.add("k-down");
  }, true);
  var up=function(){ var d=document.querySelectorAll(".k-down"); for(var i=0;i<d.length;i++) d[i].classList.remove("k-down"); };
  document.addEventListener("pointerup", up, true); document.addEventListener("pointercancel", up, true);

  /* แถบบนสูงได้มากกว่าหนึ่งแถวบนจอแคบ: ให้พื้นที่ทำงานเลื่อนลงตามความสูงจริง */
  /* วัดทั้งกล่องรวม padding (border-box) เพราะการหลบแถบสถานะเพิ่มแค่ padding
     ถ้าวัดแค่เนื้อใน หมุนจอแล้วแถบสูงขึ้นจะไม่มีใครรู้ พื้นที่ทำงานจะมุดใต้แถบ */
  var tb=document.getElementById("topbar");
  var fitTop=function(){
    var h=tb ? tb.getBoundingClientRect().height : 0;
    if(h>0) root.style.setProperty("--kt-top", Math.round(h)+"px");
  };
  if(tb && window.ResizeObserver){
    var ro=new ResizeObserver(fitTop);
    try{ ro.observe(tb, {box:"border-box"}); }catch(_){ ro.observe(tb); }
  }

  /* ช่องว่างใต้แถบล่างบน iPad ที่เปิดจากหน้าโฮม
     iPadOS บางรุ่นให้พื้นที่จอของแอปเตี้ยกว่าจอจริงเท่าแถบสถานะ แต่เริ่มที่ขอบบนสุด
     ของที่ติดขอบล่าง (bottom:0) จึงลอยค้างเหนือขอบจอ เหลือแถบสีพื้นว่าง ๆ ด้านล่าง
     วัดจากกล่อง fixed จริงเทียบกับขนาดจอ แล้วตั้ง --kt-gap ให้ CSS ขยายแถบล่างลงไปถึงขอบ
     ใช้เฉพาะตอนเปิดเป็นแอปเต็มจอ (ความกว้างต้องเท่าจอ) และช่องว่างต้องไม่เกิน 60px
     ถ้าไม่เข้าเงื่อนไขเป็น 0 ไม่เปลี่ยนอะไร */
  var probe=document.createElement("div");
  probe.setAttribute("aria-hidden","true");
  probe.style.cssText="position:fixed;top:0;bottom:0;left:0;width:0;visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  var standalone=function(){
    return navigator.standalone===true || !!(window.matchMedia && matchMedia("(display-mode: standalone)").matches);
  };
  var fitGap=function(){
    var gap=0;
    if(standalone()){
      var a=screen.width, b=screen.height, land=window.innerWidth>window.innerHeight;
      var W=land?Math.max(a,b):Math.min(a,b), H=land?Math.min(a,b):Math.max(a,b);
      var d=Math.round(H-probe.getBoundingClientRect().height);
      if(Math.abs(window.innerWidth-W)<=2 && d>=8 && d<=60) gap=d;
    }
    root.style.setProperty("--kt-gap", gap+"px");
    /* ช่องว่างนี้คือความสูงแถบสถานะพอดี ถ้าเครื่องดันรายงาน safe-area ด้านบนเป็น 0
       ทั้งที่แถบสถานะทับอยู่ ใช้ค่านี้แทน แถบบนจะได้ไม่โดนเวลา/แบตทับ */
    root.style.removeProperty("--sat");
    if(gap>0){
      probe.style.paddingTop="var(--sat)";
      var sat=parseFloat(getComputedStyle(probe).paddingTop)||0;
      probe.style.paddingTop="";
      if(sat<1) root.style.setProperty("--sat", gap+"px");
    }
    fitTop();
  };
  fitGap();
  var gapLater=function(){ fitGap(); setTimeout(fitGap, 350); };
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(fitTop);   // iOS อัปเดตขนาดจอช้ากว่าอีเวนต์หมุนจอ
  window.addEventListener("resize", gapLater);
  window.addEventListener("orientationchange", gapLater);
  if(window.visualViewport) visualViewport.addEventListener("resize", gapLater);

  /* สวิตช์กลางวัน / กลางคืน / ตามเครื่อง ไว้ในแถบล่างแถวเดียวกับเสียงเพลง/กลอง */
  var host=document.getElementById("rowMain");
  if(host && !document.getElementById("kMode")){
    var w=document.createElement("div"); w.className="kmode-wrap";
    w.innerHTML='<span class="grpname">แสงหน้าจอ</span>'+
      '<div class="seg" id="kMode" role="group" aria-label="แสงหน้าจอ">'+
      '<button type="button" data-mode="day">กลางวัน</button>'+
      '<button type="button" data-mode="night">กลางคืน</button>'+
      '<button type="button" data-mode="auto">ตามเครื่อง</button></div>';
    host.appendChild(w);
    w.addEventListener("click", function(e){
      var b=e.target.closest("button[data-mode]"); if(!b) return;
      pref=b.dataset.mode; try{ localStorage.setItem(KEY, pref); }catch(err){}
      apply();
    });
  }

  /* ไฟจังหวะ + มาตรวัด ข้างนาฬิกา */
  var clock=document.getElementById("clock"), play=document.getElementById("play");
  if(clock && !document.getElementById("kLamp")){
    var lamp=document.createElement("span"); lamp.id="kLamp"; lamp.setAttribute("aria-hidden","true");
    clock.parentNode.insertBefore(lamp, clock);
    var vu=document.createElement("span"); vu.id="kVu"; vu.setAttribute("aria-hidden","true");
    vu.innerHTML='<svg viewBox="0 0 70 34"><path d="M8 30 A28 28 0 0 1 62 30" fill="none" class="kvu-arc"/>'+
      '<path d="M50.5 11.5 A28 28 0 0 1 62 30" fill="none" class="kvu-red"/>'+
      '<g class="kvu-ticks"><line x1="11.2" y1="22.4" x2="14" y2="23.6"/><line x1="18" y1="13.6" x2="19.8" y2="16"/>'+
      '<line x1="35" y1="8" x2="35" y2="11"/><line x1="52" y1="13.6" x2="50.2" y2="16"/><line x1="58.8" y1="22.4" x2="56" y2="23.6"/></g>'+
      '<g id="kNeedle" style="transform-origin:35px 32px;transform:rotate(-50deg)"><line x1="35" y1="32" x2="35" y2="7"/></g>'+
      '<circle cx="35" cy="32" r="2.6"/></svg><span>เสียง</span>';
    clock.parentNode.insertBefore(vu, clock.nextSibling);
    var needle=vu.querySelector("#kNeedle");
    var reduce=window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    var lastBeat=null, lastBar=null, timer=0, level=0, raf=0;
    var playing=function(){ return play && /พัก/.test(play.textContent); };
    var blink=function(isBar){
      lamp.className="on"+(isBar?" bar":"");
      clearTimeout(timer); timer=setTimeout(function(){ lamp.className=""; }, isBar?150:90);
    };
    /* กันนาฬิกาเปลี่ยนความกว้าง: จองที่ไว้พอสำหรับห้องสองหลักตั้งแต่แรก
       และไม่ยอมหดกลับ ถ้าข้อความยาวขึ้นเกินที่จองไว้ (ห้อง 100 นาที 10) ขยายครั้งเดียวแล้วค้างไว้
       วัดเฉพาะตอนจำนวนตัวอักษรเปลี่ยน ไม่บังคับ layout ทุกเฟรมตอนเล่น */
    var clockLen=-1;
    var reserve=function(sample){
      var probe=clock.cloneNode(false); probe.removeAttribute("id");
      probe.style.cssText="position:absolute;visibility:hidden;left:-9999px;top:0;min-width:0";
      probe.textContent=sample; clock.parentNode.appendChild(probe);
      var w=Math.ceil(probe.getBoundingClientRect().width); probe.remove();
      if(w > (parseFloat(clock.style.minWidth)||0)) clock.style.minWidth=w+"px";
    };
    var fit=function(force){
      var t=clock.textContent||"";
      if(!force && t.length===clockLen) return;
      clockLen=t.length;
      reserve(t.replace(/\d/g,"8"));
      reserve("ห้อง 88 · จังหวะ 8 · 8:88.88");
    };
    fit(true);
    if(document.fonts && document.fonts.ready) document.fonts.ready.then(function(){ clock.style.minWidth=""; fit(true); });
    new MutationObserver(function(){
      fit(false);
      var m=/ห้อง\s*(\d+)\s*·\s*จังหวะ\s*(\d+)/.exec(clock.textContent||"");
      if(!m) return;
      if(playing() && (m[1]!==lastBar || m[2]!==lastBeat)) blink(m[1]!==lastBar);
      lastBar=m[1]; lastBeat=m[2];
    }).observe(clock, {childList:true, characterData:true, subtree:true});
    var frame=function(){
      raf=0;
      if(meter){
        meter.an.getFloatTimeDomainData(meter.buf);
        var sum=0, b=meter.buf; for(var i=0;i<b.length;i++) sum+=b[i]*b[i];
        var rms=Math.sqrt(sum/b.length), db=20*Math.log10(rms+1e-6);   // ราว -60 ถึง 0
        var v=Math.max(0, Math.min(1, (db+48)/45));
        level = v>level ? v : level*(reduce?0:.88);
      } else level*=.88;
      needle.style.transform="rotate("+(-50+level*100)+"deg)";
      if(playing() || level>.01) raf=requestAnimationFrame(frame);
    };
    if(play) new MutationObserver(function(){ if(playing() && !raf) raf=requestAnimationFrame(frame); })
      .observe(play, {childList:true, characterData:true, subtree:true});
  }
  apply();
}

window.KlongTheme={
  get mode(){ return night?"night":"day"; },
  get pref(){ return pref; },
  get focus(){ return night ? "rgba(201,161,95,.10)" : "rgba(197,154,78,.16)"; },
  unmapped: unmapped
};
if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", ready);
else ready();
})();
