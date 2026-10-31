# ไลบรารีที่ฝากไว้ในเครื่อง (lib/)

แอปห้ามโหลดอะไรจากเว็บอื่น (CSP `default-src 'self'`) ไลบรารีทุกตัวจึงวางไว้ที่นี่ และโหลดเฉพาะตอนใช้ครั้งแรก

| ไฟล์ | ที่มา | สัญญาอนุญาต | ใช้ทำอะไร |
|---|---|---|---|
| `mp4-muxer-5.2.2.js` | npm `mp4-muxer@5.2.2` → `build/mp4-muxer.js` (UMD, ตัวแปร `Mp4Muxer`) | MIT © 2023 Vanilagy | ห่อภาพ+เสียงที่เข้ารหัสด้วย WebCodecs เป็นไฟล์ .mp4 ตอนส่งออกวิดีโอโน้ต |
| `signalsmith-stretch-1.3.2.js` | npm `signalsmith-stretch@1.3.2` → `SignalsmithStretch.js` (UMD, ตัวแปร `SignalsmithStretch`) | MIT © Geraint Luff / Signalsmith Audio Ltd | ยืดเสียงเพลงแบบเรียลไทม์ตอนปรับความเร็ว ไม่เปลี่ยนระดับเสียง |
| `signalsmith-stretch-worklet-1.3.2.js` | สร้างจากไฟล์บนด้วย `node tools/build-stretch-worklet.js` | MIT (เหมือนต้นฉบับ) | โค้ดฝั่ง AudioWorklet ของตัวบน แยกเป็นไฟล์เพราะ CSP ไม่ให้โหลดจาก blob: |

ข้อความสัญญาอนุญาตเต็มอยู่ที่ `LICENSES.txt`

ไฟล์ไม่ได้แก้เนื้อหาเลย (ตรวจได้ด้วย sha256 ของแพ็กเกจบน npm) ชื่อไฟล์ใส่เลขรุ่นไว้
เพราะ Service Worker เก็บสำเนาไว้ — เปลี่ยนรุ่นต้องเปลี่ยนชื่อไฟล์ ไม่งั้นเครื่องผู้ใช้จะค้างรุ่นเก่า
