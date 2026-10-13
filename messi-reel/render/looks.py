"""ภาษาภาพของแต่ละยุค — สี แสง ฉากหลัง เนื้อภาพ

กติกา: ทุกยุคใช้ชุดสีหลักชุดเดียวกัน (ฟ้า-ขาวอาร์เจนตินา · ทอง · กรมท่ากลางคืน)
ต่างกันแค่ "อุณหภูมิ" และ "คุณภาพของภาพ" ที่ค่อย ๆ ชัดขึ้นตามปี
2006 = ภาพทีวีเก่า → 2026 = ภาพภาพยนตร์คมชัด
"""

PALETTE = {
    "celeste": (0.459, 0.667, 0.859),   # #75AADB ฟ้าอาร์เจนตินา
    "white": (0.957, 0.965, 0.973),
    "gold": (0.949, 0.757, 0.306),      # #F2C14E
    "gold_deep": (0.831, 0.588, 0.169),
    "navy": (0.043, 0.078, 0.149),      # #0B1426
    "red": (0.85, 0.16, 0.14),
}

# ค่าต่อยุค
#   bg_top/bg_bottom  ไล่สีฉากหลัง
#   bokeh             สีไฟสนามที่เบลอ, จำนวน
#   rim               สีไฟขอบรอบตัวฮีโร่
#   lift/gamma/gain   เกรดสี (ต่อช่อง R,G,B)
#   sat, contrast     ความอิ่มสี, คอนทราสต์
#   bloom, grain, vignette
#   soft              ลดความคมแบบภาพ SD (0 = คมเต็ม)
#   crt               สแกนไลน์ + กรอบทีวี
#   pylons            เสาไฟสนามหลังอัฒจันทร์ (นัดชิงที่มารากานา / ลูไซล์)
LOOKS = {
    "intro": dict(
        bg_top=(0.02, 0.035, 0.07), bg_bottom=(0.05, 0.09, 0.17),
        bokeh=((0.55, 0.7, 0.95), 46), rim=(0.70, 0.85, 1.0), rim_amt=1.0,
        lift=(0.0, 0.0, 0.01), gamma=(1.0, 1.0, 1.02), gain=(1.0, 1.0, 1.02),
        sat=1.0, contrast=1.08, bloom=0.55, grain=0.02, vignette=0.55, soft=0.0, crt=0.0, pylons=0.0),
    "e2006": dict(
        bg_top=(0.07, 0.065, 0.06), bg_bottom=(0.16, 0.14, 0.12),
        bokeh=((0.95, 0.85, 0.65), 30), rim=(1.0, 0.9, 0.75), rim_amt=0.55,
        lift=(0.05, 0.04, 0.03), gamma=(1.05, 1.0, 0.93), gain=(1.0, 0.97, 0.88),
        sat=0.45, contrast=0.92, bloom=0.35, grain=0.05, vignette=0.75, soft=0.62, crt=1.0, pylons=0.0),
    "e2010": dict(
        bg_top=(0.05, 0.07, 0.10), bg_bottom=(0.13, 0.17, 0.22),
        bokeh=((0.75, 0.85, 1.0), 38), rim=(0.75, 0.88, 1.0), rim_amt=0.7,
        lift=(0.03, 0.04, 0.06), gamma=(0.97, 1.0, 1.05), gain=(0.92, 0.98, 1.06),
        sat=0.7, contrast=0.98, bloom=0.4, grain=0.032, vignette=0.6, soft=0.38, crt=0.0, pylons=0.0),
    "e2014": dict(
        bg_top=(0.02, 0.07, 0.08), bg_bottom=(0.06, 0.16, 0.16),
        bokeh=((1.0, 0.78, 0.45), 54), rim=(1.0, 0.82, 0.55), rim_amt=0.85,
        lift=(0.0, 0.025, 0.03), gamma=(1.0, 1.0, 1.0), gain=(1.06, 1.0, 0.94),
        sat=1.05, contrast=1.1, bloom=0.55, grain=0.024, vignette=0.6, soft=0.15, crt=0.0, pylons=1.0),
    "e2018": dict(
        bg_top=(0.035, 0.01, 0.012), bg_bottom=(0.14, 0.03, 0.03),
        bokeh=((1.0, 0.3, 0.22), 28), rim=(1.0, 0.25, 0.18), rim_amt=1.0,
        lift=(0.0, 0.0, 0.0), gamma=(1.0, 0.92, 0.9), gain=(1.08, 0.9, 0.88),
        sat=0.8, contrast=1.28, bloom=0.45, grain=0.034, vignette=0.85, soft=0.1, crt=0.0, pylons=0.0),
    "e2022": dict(
        bg_top=(0.07, 0.045, 0.02), bg_bottom=(0.22, 0.14, 0.05),
        bokeh=((1.0, 0.82, 0.45), 70), rim=(1.0, 0.82, 0.42), rim_amt=1.0,
        lift=(0.01, 0.005, 0.0), gamma=(1.0, 1.0, 0.96), gain=(1.08, 1.02, 0.92),
        sat=1.12, contrast=1.1, bloom=0.85, grain=0.018, vignette=0.5, soft=0.0, crt=0.0, pylons=1.0),
    "e2026": dict(
        bg_top=(0.05, 0.065, 0.16), bg_bottom=(0.24, 0.13, 0.13),
        bokeh=((1.0, 0.72, 0.5), 60), rim=(1.0, 0.78, 0.55), rim_amt=0.9,
        lift=(0.01, 0.01, 0.02), gamma=(1.0, 1.0, 1.0), gain=(1.05, 1.0, 0.97),
        sat=1.0, contrast=1.04, bloom=0.65, grain=0.014, vignette=0.5, soft=0.0, crt=0.0, pylons=0.0),
    "outro": dict(
        bg_top=(0.015, 0.025, 0.05), bg_bottom=(0.05, 0.08, 0.15),
        bokeh=((1.0, 0.8, 0.6), 40), rim=(1.0, 0.85, 0.65), rim_amt=0.9,  # อุ่นต่อจาก 2026 ไม่เย็นวูบตอนกลับสู่ภาพถ่าย
        lift=(0.0, 0.0, 0.01), gamma=(1.0, 1.0, 1.0), gain=(1.0, 1.0, 1.03),
        sat=0.95, contrast=1.04, bloom=0.6, grain=0.015, vignette=0.6, soft=0.0, crt=0.0, pylons=0.0),
}

# ตำแหน่งตัวหนังสือ (สัดส่วนความสูงจอ) — แถบบนเหนือปลายนิ้ว อยู่ในเขตปลอดภัยของ IG Reels และไม่บังเลข 10
#   ด้านบน ~12% เป็นแถบชื่อ Reels · ด้านล่าง ~24% เป็นแคปชัน/ปุ่ม · ขวา ~14% เป็นปุ่มไลก์/แชร์
SAFE = dict(top=0.12, bottom=0.76, left=0.06, right=0.86)
POS_Y = {"top": 0.150, "top2": 0.203, "upper": 0.252, "upper2": 0.302}
CX = 0.47  # แกนกลางภาพ: ขยับซ้ายนิดเดียวให้พ้นปุ่มไลก์/แชร์ด้านขวา (ทั้งตัวหนังสือและฮีโร่ใช้แกนนี้)


def mix(a, b, w):
    """ผสมค่าของสองยุค (ใช้ตรงรอยต่อยุค)"""
    if w <= 0:
        return dict(a)
    if w >= 1:
        return dict(b)
    out = {}
    for k, va in a.items():
        vb = b[k]
        if isinstance(va, tuple) and va and isinstance(va[0], tuple):
            out[k] = (tuple(x + (y - x) * w for x, y in zip(va[0], vb[0])), va[1] if w < 0.5 else vb[1])
        elif isinstance(va, tuple):
            out[k] = tuple(x + (y - x) * w for x, y in zip(va, vb))
        else:
            out[k] = va + (vb - va) * w
    return out
