/* สร้าง lib/signalsmith-stretch-worklet-1.3.2.js จาก lib/signalsmith-stretch-1.3.2.js
   ใช้: node tools/build-stretch-worklet.js

   ทำไมต้องมีไฟล์นี้
     ตัว Signalsmith Stretch สร้างโค้ดของ AudioWorklet เป็น Blob แล้วโหลดผ่าน blob: URL
     แต่ CSP ของแอปอนุญาตสคริปต์จากเว็บเดียวกันเท่านั้น ('self') ไม่มี blob: → โหลดไม่ขึ้นแบบเงียบ ๆ
     ไลบรารีเปิดช่องไว้ให้ตั้ง SignalsmithStretch.moduleUrl เป็นไฟล์จริงแทน
     สคริปต์นี้รันไลบรารีกับของปลอมของเบราว์เซอร์ แล้วจับข้อความที่มันจะใส่ลง Blob มาเขียนเป็นไฟล์
     เนื้อโค้ดจึงตรงกับที่ไลบรารีสร้างเองทุกตัวอักษร (เปลี่ยนรุ่นไลบรารี = รันสคริปต์นี้ใหม่) */
"use strict";
const fs = require("fs"), vm = require("vm"), path = require("path");
const VER = "1.3.2";
const lib = path.join(__dirname, "..", "lib");
const src = fs.readFileSync(path.join(lib, "signalsmith-stretch-" + VER + ".js"), "utf8");
let captured = null;
const sandbox = {
  console, Promise, Symbol, JSON, Object, Array, Math, Uint8Array, Float32Array, setTimeout, clearTimeout,
  window: {}, document: undefined,
  Blob: function (parts) { captured = parts.join(""); },
  URL: { createObjectURL: () => "blob:capture" },
  AudioWorkletNode: function () { throw new Error("not registered"); },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src + "\n;globalThis.__SS=SignalsmithStretch;", sandbox);
sandbox.__SS({ audioWorklet: { addModule: () => new Promise(() => {}) } });
setTimeout(() => {
  if (!captured) { console.error("ไม่ได้โค้ด worklet — ไลบรารีอาจเปลี่ยนวิธีสร้าง"); process.exit(1); }
  const head = "/* Signalsmith Stretch " + VER + " — AudioWorklet module (MIT, Geraint Luff / Signalsmith Audio)\n" +
               "   สร้างอัตโนมัติด้วย tools/build-stretch-worklet.js จาก signalsmith-stretch-" + VER + ".js ห้ามแก้มือ */\n";
  const out = path.join(lib, "signalsmith-stretch-worklet-" + VER + ".js");
  fs.writeFileSync(out, head + captured);
  console.log("เขียน", out, (head + captured).length, "ไบต์");
}, 50);
