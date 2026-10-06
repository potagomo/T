# สกิลนี้ลอกมาจากที่อื่น ไม่ใช่ของเราเขียน

| | |
|---|---|
| ต้นทาง | https://github.com/nextlevelbuilder/ui-ux-pro-max-skill |
| commit | `477bcb28c9812b385cb51a4605ddf30d7b2266e2` |
| วันที่ของ commit | 2026-10-03T23:05:26+07:00 |
| สัญญาอนุญาต | MIT — ดู `LICENSE` ในโฟลเดอร์นี้ |
| ลอกมาเมื่อ | 2026-10-06 |

**ไม่ได้แก้อะไรเลยแม้แต่ไบต์เดียว** (นอกจากเพิ่มไฟล์นี้กับ LICENSE เข้ามา)
ตั้งใจไว้แบบนี้เพื่อให้เทียบกับต้นทางได้ตรง ๆ ตอนอัปเดต

ถ้าต้องปรับพฤติกรรมให้เข้ากับโปรเจกต์นี้ **ให้ไปเขียนใน `.claude/skills/drum-pro-ui/`**
อย่าแก้ในโฟลเดอร์นี้ ไม่งั้นรอบหน้าที่อัปเดตจะชนกันและของที่แก้ไว้จะหาย

## ทำไมถึงเอามาไว้ใน repo แทนที่จะลงผ่าน marketplace

plugin ที่ลงในเครื่องผู้ใช้ไม่ตามไปที่ session บนคลาวด์ พอฝังไว้ใน repo
ทุก session ที่โคลนโปรเจกต์นี้จึงมีใช้เหมือนกันหมด และได้รุ่นที่ปักไว้แน่นอน
แลกกับการที่ต้องอัปเดตเอง

ไฟล์ชุดนี้ไม่ถูกเผยแพร่ขึ้นเว็บ — workflow เลือกอัปเฉพาะไฟล์ที่เว็บต้องใช้

## วิธีอัปเดตเป็นรุ่นใหม่

```bash
rm -rf /tmp/uiux && git clone --depth 1 \
  https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.git /tmp/uiux
rm -rf .claude/skills/ui-ux-pro-max
cp -r /tmp/uiux/.claude/skills/ui-ux-pro-max .claude/skills/ui-ux-pro-max
cp /tmp/uiux/LICENSE .claude/skills/ui-ux-pro-max/LICENSE
# แก้ commit/วันที่ในไฟล์นี้ แล้วตรวจว่ายังรันได้
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "dark audio tool" --domain style
```

ก่อนอัปเดต ควรตรวจซ้ำว่าสคริปต์ยังไม่ต่อเน็ต/ไม่เรียก subprocess/ไม่มี eval:

```bash
grep -rnE 'subprocess|urllib\.request|socket|eval\(|exec\(|os\.system|Popen' \
  .claude/skills/ui-ux-pro-max/scripts/*.py
```
