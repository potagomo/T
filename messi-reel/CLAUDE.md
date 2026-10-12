# CLAUDE.md — โปรเจกต์คลิป Lego Messi (messi-reel/)

โฟลเดอร์นี้เป็นงานแยกจากเว็บแอปครูต้าในส่วนอื่นของ repo — ไม่แตะไฟล์นอก `messi-reel/`
และไม่เกี่ยวกับ GitHub Pages (workflow deploy เฉพาะโฟลเดอร์ของเว็บ)

งานนี้มีคุณค่าทางใจสูงมากสำหรับเจ้าของงาน ทำอย่างตั้งใจ ตรวจด้วยตาทุกครั้ง อย่ารีบส่งของที่ยังไม่ได้ดู

## ก่อนเริ่ม: ภาพหลักอยู่ไหม
repo นี้เป็น public จึงไม่เก็บ `input/hero.jpg` (ผลงานเลโก้ของคนอื่น) และภาพสตอรีบอร์ดไว้ใน git
ถ้าไม่มีไฟล์นี้ ขอเจ้าของงานแนบภาพในแชต แล้วบันทึกเป็น `input/hero.jpg` — รายละเอียดใน `input/README.md`
จากนั้น `python3 -m render.reel storyboard` จะสร้างภาพสตอรีบอร์ดกลับมาเอง

## อ่านก่อนเริ่ม (ตามลำดับ)
1. `PLAN.md` — แนวคิด เส้นอารมณ์ สัดส่วน ภาษาภาพ สเปก
2. `TASKS.md` — หยิบงานถัดไป และบันทึกเมื่อเสร็จ
3. `STORYBOARD.md` — หน้าตาทุกช็อต
4. `FACTS.md` — ข้อเท็จจริงที่ใช้ได้

## กติกา
- `timeline.json` เป็นที่เดียวที่กำหนดเวลา ข้อความ และลำดับช็อต — โค้ดใน `render/` เก็บเฉพาะ "หน้าตา" (สี แสง เอฟเฟกต์)
- ห้ามเปลี่ยนสัดส่วนเวลาของแต่ละปี เส้นอารมณ์ หรือกิมมิกหลัก (ถ้วย / เลข 19→10 / ตัวต่อ) โดยไม่ถามเจ้าของงาน
- ตัวหนังสือบนจอทุกบรรทัดต้องมาจากแถว ✅ ใน `FACTS.md` — จะเพิ่มข้อเท็จจริงใหม่ต้องค้นแหล่งอ้างอิงและใส่ลิงก์ก่อน
- ห้ามเขียนว่า Messi เป็น "all-time top scorer" แบบปัจจุบันกาล (Mbappé แซงไปแล้ว 22 > 21)
- ห้ามใช้โลโก้ FIFA/AFA/แบรนด์ หรือภาพ/ฟุตเทจจริงจากการแข่งขัน ถ้วยต้องเป็นทรงทั่วไปที่วาดเอง
- **ไฟล์เพลงห้ามเข้า git ไม่ว่ากรณีใด** และห้ามเผยแพร่ เก็บนอก repo หรือใน `out/` (ถูก ignore)
- วิดีโอที่ render (`out/`) cache (`.cache/`) ภาพหลัก และภาพสตอรีบอร์ด ไม่เข้า git (ถ้าเจ้าของงานอนุญาตค่อยเอาบรรทัดใน `.gitignore` ออก)
- แก้หน้าตาเมื่อไร ต้อง `python3 -m render.reel storyboard` แล้วเปิดดูภาพ `storyboard/storyboard_*.jpg` ก่อน commit
- เอกสารเขียนภาษาไทย · ข้อความบนจอเป็นอังกฤษ (+สเปนในจุดสำคัญ)

## คำสั่ง (รันจากโฟลเดอร์ messi-reel/)
```bash
pip install -r requirements.txt               # numpy opencv-python-headless pillow numexpr
python3 -m render.reel report                 # เวลาช็อตหลังลงบีต
python3 -m render.reel still 23.6 47.5        # ภาพนิ่ง → out/still_*.png  (--size preview|storyboard|final)
python3 -m render.reel storyboard             # สตอรีบอร์ด → storyboard/
python3 -m render.reel preview [--clicks]     # คลิปร่าง 540x960 ~2 นาที → out/preview.mp4
python3 -m render.reel final                  # 4K HEVC ~1 ชม. (4 คอร์) → out/messi_reel_4k_hevc.mp4
python3 -m render.reel final --from 45 --to 48   # render เฉพาะช่วง ไว้ตรวจ
python3 tools/beatmap.py <ไฟล์เพลง>            # จับบีต → sync/beatmap.json
```
ครั้งแรกที่ render จะแยกชั้นภาพ (~15 วินาที) แล้วเก็บไว้ใน `.cache/`

## แผนที่โค้ด
- `render/timeline.py` อ่าน timeline + beatmap, ดึงขอบช็อตเข้า downbeat, ดึงเหตุการณ์เข้าบีต
- `render/hero.py` แยกภาพเป็นหุ่นเชิดตาม `input/hero_rig.json` (GrabCut + เติมช่องลำแสงตามแนวรัศมี + ทำเลข 19)
- `render/compose.py` ประกอบเฟรม: ฉากหลัง → ถ้วย → หุ่น → อนุภาค → เกรดสี → ตัวหนังสือ → เอฟเฟกต์จอ
  แต่ละ `"do"` ใน timeline มีเมธอดชื่อใกล้กัน (trophy, number_state, odometer, score, counter, confetti ...)
- `render/looks.py` สี/แสง/เนื้อภาพของแต่ละยุค + ตำแหน่งช่องตัวหนังสือ
- `render/gfx.py` ถ้วย ดาว ป้าย C ตัวหนังสือ แฟลช · `render/fx.py` เกรดสี บลูม เกรน ทีวีเก่า กลิตช์
- `render/reel.py` คำสั่งทั้งหมด (render หลาย process แล้วต่อไฟล์)
- `tools/beatmap.html` หน้าเว็บจับบีตบนมือถือ (เผยแพร่ที่ https://claude.ai/artifact/A6149Q4q1vrV3D4TPmceg5 — แก้ไฟล์นี้แล้ว publish ด้วย url เดิม)
