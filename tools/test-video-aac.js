/* ตรวจว่าวิดีโอที่ส่งออกจาก iPad มีเสียง — จำลองสิ่งที่ Safari ส่งมาให้
   ใช้: node tools/test-video-aac.js   (ต้องมี ffmpeg/ffprobe ในเครื่อง ถ้าไม่มีจะข้าม)

   ที่มา: ผู้ใช้ส่งออกวิดีโอบน iPad (iPadOS 26) แล้วได้แต่ภาพ เสียงเงียบทั้งไฟล์
   ตัวเข้ารหัส AAC ของ Safari ส่ง decoderConfig.description เป็นเนื้อกล่อง esds ทั้งก้อน
   แทน AudioSpecificConfig 2 ไบต์ (WebKit bug 302253) ห่อลง MP4 แล้วเครื่องเล่นถอดรหัสไม่ได้
   แอปแก้ด้วย vxAacMeta() (สร้าง AudioSpecificConfig เอง) และ vxAacData() (ตัดหัว ADTS ถ้ามี)
   สคริปต์นี้ดึงสองฟังก์ชันนั้นจาก index.html จริง ป้อนเฟรม AAC จาก ffmpeg + description แบบที่ Safari ส่ง
   แล้วตรวจว่าไฟล์ที่ได้ถอดรหัสเป็นเสียงจริง 44.1 kHz 2 ช่อง — และไฟล์ที่ไม่ผ่านการแก้ถอดรหัสไม่ได้ (ยืนยันว่าจำลองถูก) */
"use strict";
const fs = require("fs"), vm = require("vm"), os = require("os"), path = require("path");
const { execFileSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const have = (b) => { try { execFileSync(b, ["-version"], { stdio: "ignore" }); return true; } catch (e) { return false; } };
if (!have("ffmpeg") || !have("ffprobe")) { console.log("ข้าม: ไม่มี ffmpeg/ffprobe"); process.exit(0); }

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const grab = (name) => { const i = html.indexOf(name); if (i < 0) throw new Error("ไม่พบ " + name); return html.slice(i, html.indexOf("\n}\n", i) + 2); };
const code = "const VX_SRI=" + /const VX_SRI=(\[[^\]]+\]);/.exec(html)[1] + ";\n" +
  grab("function vxAsc(") + grab("function vxAacMeta(") + grab("function vxAacData(") + ";globalThis.F={vxAsc,vxAacMeta,vxAacData};";
const sb = { Uint8Array, ArrayBuffer, Object }; vm.createContext(sb); vm.runInContext(code, sb);
const F = sb.F;
const mm = { console, TextEncoder, Uint8Array, DataView, ArrayBuffer, Math, Number, Array, Object, Error, TypeError, Map, WeakMap, Set, Symbol, Promise, JSON };
mm.globalThis = mm; vm.createContext(mm);
vm.runInContext(fs.readFileSync(path.join(ROOT, "lib/mp4-muxer-5.2.2.js"), "utf8") + ";globalThis.M=Mp4Muxer;", mm);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "klong-aac-"));
const fail = [];
for (const sr of [44100, 48000]) {
  const aac = path.join(dir, "in-" + sr + ".aac");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=" + sr + ":duration=2", "-ac", "2", "-c:a", "aac", "-b:a", "320k", "-f", "adts", aac]);
  const adts = fs.readFileSync(aac), frames = [];
  for (let p = 0; p + 7 < adts.length;) { const len = ((adts[p + 3] & 3) << 11) | (adts[p + 4] << 3) | (adts[p + 5] >> 5); frames.push(adts.subarray(p, p + len)); p += len; }
  const asc = F.vxAsc(sr, 2);
  const bogus = new Uint8Array([3, 25, 0, 0, 0, 4, 17, 64, 21, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 2, asc[0], asc[1]]);   // แบบที่ Safari ส่ง
  for (const [mode, fix, adtsHead] of [["แก้แล้ว-ADTS", true, true], ["แก้แล้ว-เฟรมเปล่า", true, false], ["ไม่แก้ (ควรเงียบ)", false, false]]) {
    const target = new mm.M.ArrayBufferTarget();
    const mux = new mm.M.Muxer({ target, fastStart: "in-memory", firstTimestampBehavior: "offset", audio: { codec: "aac", numberOfChannels: 2, sampleRate: sr } });
    frames.forEach((f, i) => {
      let b = new Uint8Array(f); if (!adtsHead) b = b.subarray((b[1] & 1) ? 7 : 9);
      const raw = { decoderConfig: { codec: "mp4a.40.2", sampleRate: sr, numberOfChannels: 2, description: bogus } };
      const meta = i === 0 ? (fix ? F.vxAacMeta(raw, sr, 2) : raw) : undefined;
      mux.addAudioChunkRaw(fix ? F.vxAacData(b) : b, "key", Math.round(i * 1024 / sr * 1e6), Math.round(1024 / sr * 1e6), meta);
    });
    mux.finalize();
    const out = path.join(dir, "out.mp4"); fs.writeFileSync(out, Buffer.from(target.buffer));
    let pcm = Buffer.alloc(0);
    try { pcm = execFileSync("ffmpeg", ["-v", "error", "-i", out, "-f", "s16le", "-"], { stdio: ["ignore", "pipe", "ignore"] }); } catch (e) {}
    let e = 0; for (let i = 0; i + 1 < pcm.length; i += 200) { const v = pcm.readInt16LE(i) / 32768; e += v * v; }
    const rms = pcm.length ? Math.sqrt(e / (pcm.length / 200)) : 0, heard = rms > 0.01;
    console.log(`${sr} Hz · ${mode}: ${heard ? "มีเสียง" : "เงียบ/ถอดไม่ได้"} (rms ${rms.toFixed(3)})`);
    if (fix && !heard) fail.push(`${sr} ${mode}: วิดีโอไม่มีเสียง`);
    if (!fix && heard) fail.push(`${sr}: ไฟล์ที่ไม่แก้กลับมีเสียง — จำลองบั๊กของ Safari ไม่ถูก`);
  }
}
fs.rmSync(dir, { recursive: true, force: true });
if (fail.length) { console.log("ไม่ผ่าน:\n - " + fail.join("\n - ")); process.exit(1); }
console.log("ผ่าน");
