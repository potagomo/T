# TASKS — งานที่เหลือ แบ่งให้ Claude ทำต่อทีละชิ้น

วิธีใช้ไฟล์นี้ (สำหรับ Claude ทุก session)
1. อ่าน `CLAUDE.md` → `PLAN.md` → ไฟล์นี้
2. หยิบงานแรกที่ยังไม่ติ๊ก และไม่ได้ติดรอเจ้าของงาน (`รอ: เจ้าของงาน`)
3. ทำให้ผ่าน "เกณฑ์เสร็จ" ทุกข้อ แล้วติ๊ก `[x]` และเขียนบันทึกสั้น ๆ ในส่วน "บันทึกงาน" ท้ายไฟล์
4. commit พร้อมข้อความที่บอกว่าทำ WP ไหน
5. งานที่ต้องให้เจ้าของงานตัดสินใจ (สัดส่วน อารมณ์ ข้อความ) ให้ถามก่อน ห้ามเดา

ลิงก์ที่ใช้บ่อย
- Production Storyboard (หน้าเว็บมีภาพทุกช็อต): https://claude.ai/artifact/HiiqrRSHR3MRRPJUF9dU9z — สร้างใหม่ด้วย `python3 tools/make_board.py` แล้ว publish ทับ url เดิม
- Politik Beat Map (จับบีตบนมือถือ): https://claude.ai/artifact/A6149Q4q1vrV3D4TPmceg5

สถานะ: `[x]` เสร็จ · `[ ]` ยังไม่ทำ · `[~]` ทำไปบางส่วน

---

## WP-0 วางระบบ + v1 `[x]`
ข้อเท็จจริง (FACTS.md) · rig 5 ชั้น + เลข 19 · ตัว render · เครื่องมือจับบีต · storyboard v1

## WP-0b v2 ตามบรีฟ "The Last Dance of a Generation" `[x]`
- [x] เปิด/ปิดด้วยภาพถ่ายจริง · 24 fps · อัฒจันทร์ ลูกบอล เงาบังหน้า แสงความทรงจำ · โคจรบางส่วน
- [x] ตัวหนังสือเหลือเลขปี + ประโยคหลัก 4 ประโยค + ตัวยึดข้อเท็จจริง · ถ้วย 2022 กลายเป็นดาวดวงที่ 3
- [x] บันทึกการผลิต 10 หัวข้อทุกช็อตใน `timeline.json` → `STORYBOARD.md` + หน้าเว็บ Production Storyboard
- [x] เสียงประกอบ `render/sfx.py` · ภาพปก `cover/`
- [x] 4K HEVC v2 (เวลาตามแผน ยังไม่ลงบีต) → `out/messi_reel_4k_hevc.mp4` + `_sfx.mp4`

## WP-1 จับบีตเพลงจริง `[ ]` รอ: เจ้าของงาน
1. เปิด Politik Beat Map บนมือถือ → เลือกไฟล์ Politik (เริ่ม 4:00 ยาว 79 วินาที)
2. กดเล่น ฟังว่าเสียงเคาะตรงไหม ถ้าไม่ตรงใช้ ÷2 / ×2 / เลื่อน ±20ms
3. ปักหมุดจุดที่เพลงเปลี่ยนอารมณ์ (เบาลง เร่ง พีค เปียโนเข้า คอร์ดสุดท้าย)
4. กด "คัดลอกผล" แล้ววางในแชตกับ Claude

ทางเลือก: แนบไฟล์เพลงให้ Claude แล้วรัน `python3 tools/beatmap.py <ไฟล์>` (ไฟล์เพลงเก็บนอก repo เท่านั้น)

เกณฑ์เสร็จ: มี `sync/beatmap.json` ที่ `source` ไม่ใช่ DEMO และมี `beats` อย่างน้อย 60 จุด

## WP-2 ลงจังหวะ (sync pass) `[ ]` ต่อจาก WP-1
1. บันทึก JSON เป็น `sync/beatmap.json` (ตรวจ `song_in` ≈ 240, `duration` ≈ 79)
2. `python3 -m render.reel report` — คอลัมน์ snap ไม่ควรเกิน ±0.6s และไม่มีช็อตสั้นกว่า 1.5s
3. เทียบหมุดกับเส้นอารมณ์ (`PLAN.md` ข้อ 3 และคอลัมน์ "ความสัมพันธ์กับเพลง" ใน STORYBOARD.md)
   - ถ้าพีคใหญ่ของเพลงอยู่ช่วง 45–50s (S17) และช่วงอุ่นท้ายเพลงอยู่ใน S23 อยู่แล้ว → ไม่ต้องแก้
   - ถ้าไม่ตรง → เสนอทางเลือก 2–3 แบบ (เช่นขยับขอบบท ±1–2s) ให้เจ้าของงานเลือก ห้ามแก้เงียบ ๆ
   - หมุด `last_chord` ควรอยู่ใกล้ 78.2s (เริ่มเฟดดำ) ถ้าห่างเกิน 0.5s ให้ขยับ `fade_out` ใน S24
4. `python3 -m render.reel preview --clicks` แล้วดูว่า: เลขปีหมุนลงบีต · 19→10 ลงบีต · 113' ลง accent · ถ้วยแตะที่ลงบีต · ไฟสนามเปิดตามบีต
5. `python3 -m render.reel storyboard` · `python3 tools/make_board.py --status-sync "ลงบีตแล้ว"` แล้ว publish หน้า board ทับ url เดิม

เกณฑ์เสร็จ: report ผ่าน · preview_clicks ส่งให้เจ้าของงานดูแล้ว · หน้า board แสดงตารางเวลาจริง

## WP-3 ขัดเกลาภาพ `[~]` ทำได้เลย
ดูภาพนิ่งก่อน/หลัง (`python3 -m render.reel still <วินาที>`) ทุกข้อ
- [x] ถ้วย: แสงสะท้อนโลหะวิ่งพาดเฉียงทุก ~2.6 วินาที ยังเป็นถ้วยทรงทั่วไป (`render/compose.py` → `trophy`)
- [x] S05 เลขพลิกแบบป้ายพลิก: ครึ่งบนเลขเดิมพับลง → ครึ่งล่างเลขใหม่ตามลงมา 0.28 วินาที + เสียงแปะตอนจบ (`draw_puppet` ส่วน flip, `FLIP_PRE/FLIP_POST`)
- [x] S23 ไฟมือถือ: 22% โบกเป็นแนวโค้ง แถวหน้าแน่นกว่าแถวไกล (`phonelights`)
- [x] อัฒจันทร์: เสาไฟสนาม 4 ต้น แผงไฟ 5×3 ดวง เฉพาะปี 2014 และ 2022 (`looks.py` → `pylons`, `_pylons_base`)
- [ ] ตรวจทุกช็อตว่าตัวหนังสือไม่ชนกัน ไม่ทับนิ้ว อ่านออกบนพื้นสว่าง (โดยเฉพาะ S17 S18)
เกณฑ์เสร็จ: storyboard ใหม่ + ภาพก่อน/หลัง ส่งให้เจ้าของงานดู

## WP-4 ตัวจริง 4K HEVC (หลังลงบีต) `[ ]` ต่อจาก WP-2
1. `python3 -m render.reel final` (~40 นาที บน 4 คอร์ — รันแบบ background)
2. `python3 -m render.sfx --mux out/messi_reel_4k_hevc.mp4`
3. QC อัตโนมัติ: `ffprobe -v error -show_entries stream=codec_name,codec_tag_string,profile,width,height,pix_fmt,r_frame_rate,color_primaries:format=duration,size -of compact out/messi_reel_4k_hevc_sfx.mp4`
   ต้องได้ hevc · hvc1 · Main · 2160x3840 · yuv420p · 24/1 · bt709 · 79.0s · มี aac
4. QC ด้วยตา: แผ่นภาพ 1 เฟรม/วินาที (`ffmpeg -i ... -vf "fps=1,scale=150:266,tile=16x5"`) หาเฟรมดำ ตัวหนังสือเพี้ยน ตัวอักษรบนเสื้อผิด
5. คลิปตรวจ 1080p: `ffmpeg -i out/messi_reel_4k_hevc_sfx.mp4 -vf scale=1080:1920 -c:v libx264 -crf 21 -c:a copy out/review_1080p.mp4`

## WP-5 ส่งมอบ `[ ]`
- ส่ง `out/review_1080p.mp4` ให้ดูในแชตก่อน แล้วส่งไฟล์ 4K (`_sfx.mp4`) + `out/cover_1080x1920.png`
- ไฟล์ 4K ห้ามใส่ git · บอกขนาดไฟล์ · แนบวิธีโพสต์ IG จาก `PLAN.md` ข้อ 6

## WP-6 ภาพต้นฉบับความละเอียดสูง `[ ]` ไม่บังคับ · รอ: เจ้าของงาน
ไฟล์ใหญ่กว่า หรือขยายด้วย Upscayl (Real-ESRGAN ×4) → วางทับ `input/hero.jpg` (ภาพเดียวกัน กรอบเดียวกัน)
→ ลบ `.cache/` → render ใหม่ → ตรวจภาพแยกชั้นอีกครั้ง (rig ปรับพิกัดตามขนาดเอง)

## WP-7 แทรกภาพเคลื่อนไหวจาก AI `[ ]` ไม่บังคับ · ต้องถามเจ้าของงานก่อน
เวอร์ชันนี้ตั้งใจไม่ใช้ AI image-to-video (เสี่ยงตัวอักษรบนเสื้อเพี้ยน รูปทรงเลโก้ละลาย)
ถ้าเจ้าของงานอยากลอง: ใช้ Kling / Runway / Veo กับ `input/hero.jpg` สร้างคลิปสั้น 2–3 วินาที
- พรอมต์: "Physical LEGO brick mosaic sculpture of a footballer seen from behind, sky-blue and white striped number 10 shirt, both index fingers pointing up, completely static object, only the camera slowly pushes in, soft stadium light moving across the plastic bricks, shallow depth of field, 9:16"
- พรอมต์ห้าม: "moving limbs, changing text, melting, morphing, extra fingers, human skin, new letters"
- ต้องเพิ่ม action `clip` ใน `render/compose.py` และตรวจตัวอักษรบนเสื้อทุกเฟรม

## WP-8 ปรับเสียงประกอบกับเพลงจริง `[ ]` ต่อจาก WP-1
เมื่อมี beatmap: เลื่อนเสียงกระแทก/สวิตช์ไฟ/หัวใจให้ตรงบีต (ใช้เวลาจาก timeline อยู่แล้ว) และลดเสียงฝูงชนช่วงที่เพลงเบา
(`energy` ใน beatmap) ให้เพลงเด่นเสมอ — ฟังเทียบในแอป IG ก่อนโพสต์

---

## บันทึกงาน
- 2026-10-12 · WP-0 · v1 storyboard + คลิปร่าง (30 fps)
- 2026-10-12 · WP-0b · v2 ตามบรีฟใหม่: ภาพถ่ายจริงหัว-ท้าย, 24 fps, สนาม, ลูกบอล, โคจรบางส่วน, ประโยคหลัก, เสียงประกอบ, ภาพปก, หน้า Production Storyboard
