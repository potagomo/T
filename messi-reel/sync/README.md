# sync/

วาง `beatmap.json` ที่ได้จากหน้า Politik Beat Map (หรือ `tools/beatmap.py`) ไว้ที่นี่
มีแค่ตัวเลขเวลาของบีต ไม่มีเสียง จึงเข้า git ได้

รูปแบบ
```json
{"song_in": 240, "duration": 79, "bpm": 85.9,
 "beats": [0.25, 0.95, ...], "downbeats": [0.25, 3.04, ...],
 "energy_rate": 10, "energy": [0.12, 0.15, ...],
 "markers": {"quiet": 33.2, "last_chord": 77.8}}
```
ถ้าไม่มีไฟล์นี้ ตัว render ใช้เวลาตามแผนใน `timeline.json` และปิดเอฟเฟกต์ที่เต้นตามบีต
