#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""รวมไฟล์ต้นฉบับรุ่นใหม่เข้ากับ index.html โดยไม่ทับงานที่เราแก้ไว้

วิธีใช้
    python3 tools/merge-upstream.py ~/Downloads/klong-pro-9.html

ทำไมต้อง merge ไม่ใช่ regenerate
    index.html ที่ deploy อยู่ = ต้นฉบับ + ชั้นเว็บแอป + งาน UI ที่แก้ไว้
    ถ้าเอาไฟล์ใหม่มาเติมชั้นเว็บแอปแล้วเขียนทับ งาน UI จะหายทั้งหมด
    เพราะไฟล์ใหม่ไม่รู้จักงานนั้น

    วิธีที่ถูกคือ three-way merge: บอก git ว่า "รุ่นก่อนหน้าเป็นแบบนี้
    เราแก้เป็นแบบนี้ ผู้พัฒนาแก้เป็นแบบนั้น" แล้วให้มันรวมให้
    ส่วนที่คนละที่กันจะรวมได้เอง ส่วนที่แก้ทับที่เดียวกันจะเตือนให้ตัดสิน
    ซึ่งดีกว่าเงียบ ๆ เลือกข้างเอง

จุดอ้างอิง (merge base) คือ upstream/klong-pro.html — ไฟล์รุ่นที่แล้วแบบดิบ
สคริปต์นี้อัปเดตให้เองหลังรวมสำเร็จ

ออก 0 = รวมเรียบร้อย · 1 = มีปัญหาต้องแก้ก่อน · 2 = เรียกใช้ผิด
"""
import io, os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import _layer

BASE = os.path.join(ROOT, "upstream", "klong-pro.html")
LIVE = os.path.join(ROOT, "index.html")

# ของที่ชั้นเว็บแอปต้องมี ใช้ตรวจหลัง merge ว่าไม่ได้หายไประหว่างทาง
LAYER_MARKS = [
    (u"CSP",                   r'http-equiv="Content-Security-Policy"'),
    (u"manifest",              r'rel="manifest"'),
    (u"apple-touch-icon",      r'rel="apple-touch-icon"'),
    (u"Service Worker",        r'serviceWorker.register'),
    (u"safe-area",             r'safe-area-inset-bottom'),
    (u"ฟอนต์ในเครื่อง",         r'fonts/ibm-plex-sans-thai.css'),
    (u"viewport-fit",          r'viewport-fit=cover'),
]


def die(msg, code=1):
    sys.stderr.write(u"\n❌  %s\n\n" % msg)
    sys.exit(code)


def read(p):
    return io.open(p, encoding="utf-8").read()


def main():
    if len(sys.argv) != 2:
        sys.stderr.write(__doc__)
        sys.exit(2)
    new_src = sys.argv[1]

    for p, what in [(new_src, u"ไฟล์ต้นฉบับรุ่นใหม่"),
                    (BASE, u"จุดอ้างอิง upstream/klong-pro.html"),
                    (LIVE, u"index.html")]:
        if not os.path.isfile(p):
            die(u"ไม่พบ%s: %s" % (what, p))

    new_html = read(new_src)

    # ---- ด่านที่ 1: ไฟล์ใหม่ "เพิ่ม" ของจากข้างนอกเข้ามาหรือเปล่า ----
    # ด่านนี้สำคัญที่สุด เพราะ CSP จะบล็อกเงียบ ๆ ไม่มี error ให้เห็น
    # เทียบกับรุ่นก่อนหน้า ไม่ใช่จับทุกลิงก์ เพราะ Google Fonts ที่ติดมากับ
    # ไฟล์ดิบเป็นของเดิมและถูก merge ตัดทิ้งให้อยู่แล้ว (ดู _layer)
    problem = _layer.new_external_problem(new_html, read(BASE))
    if problem:
        die(problem + u"\n\n    ยังไม่ได้แตะ index.html เลย")

    # ---- ด่านที่ 2: เป็นไฟล์ต้นฉบับดิบจริงไหม ----
    if u"ชั้นเว็บแอป" in new_html:
        die(u"ไฟล์นี้มีชั้นเว็บแอปอยู่แล้ว\n"
            u"    ถ้าคุณพัฒนาต่อจาก index.html (ซึ่งแนะนำ) ให้ใช้ไฟล์นั้นแทน:\n"
            u"      cp <ไฟล์ของคุณ> index.html   แล้ว commit ตามปกติ\n"
            u"    สคริปต์นี้มีไว้รับไฟล์ดิบที่ยังไม่เติมชั้นเว็บแอปเท่านั้น")
    if new_html == read(BASE):
        die(u"ไฟล์นี้เหมือนกับรุ่นที่รวมไปแล้วทุกไบต์ ไม่มีอะไรต้องทำ")

    # ---- รวมสามทาง ----
    tmp = tempfile.mkdtemp(prefix="merge-upstream-")
    try:
        merged = os.path.join(tmp, "merged.html")
        base_c = os.path.join(tmp, "base.html")
        their  = os.path.join(tmp, "theirs.html")
        shutil.copyfile(LIVE, merged)
        shutil.copyfile(BASE, base_c)
        shutil.copyfile(new_src, their)

        r = subprocess.run(
            ["git", "merge-file", "-L", "index.html ของเรา", "-L", "รุ่นก่อนหน้า",
             "-L", "ไฟล์ใหม่ที่ส่งมา", merged, base_c, their],
            capture_output=True, text=True)

        if r.returncode < 0 or r.returncode > 127:
            die(u"git merge-file ทำงานไม่สำเร็จ: %s" % (r.stderr.strip() or r.returncode))

        out = read(merged)

        if r.returncode > 0:
            # ชนกัน = ทั้งสองฝั่งแก้ที่เดียวกัน ต้องให้คนตัดสิน
            marks = sum(1 for ln in out.splitlines() if ln.startswith("<<<<<<<"))
            keep = os.path.join(ROOT, "index.html.merge-conflict")
            io.open(keep, "w", encoding="utf-8").write(out)
            die(u"ชนกัน %d จุด — ทั้งเราและผู้พัฒนาแก้ตรงเดียวกัน\n"
                u"    ไฟล์ที่มีเครื่องหมายชนอยู่: %s\n"
                u"    index.html ของจริงยังไม่ถูกแตะ\n\n"
                u"    แก้ทีละจุด (เลือกฝั่งใดฝั่งหนึ่งหรือผสมกัน) ลบบรรทัด <<<<<<< ======= >>>>>>>\n"
                u"    แล้วเอาไปทับ index.html เอง จากนั้นอัปเดตจุดอ้างอิงด้วย:\n"
                u"      cp %s upstream/klong-pro.html" % (marks, keep, new_src))

        # ---- ด่านที่ 3: ชั้นเว็บแอปยังอยู่ครบไหมหลังรวม ----
        missing = [name for name, pat in LAYER_MARKS if pat not in out]
        if missing:
            die(u"รวมแล้วชั้นเว็บแอปหายไป: %s\n"
                u"    index.html ยังไม่ถูกแตะ — ต้องดูด้วยมือว่าทำไม" % u", ".join(missing))

        # ---- ด่านที่ 4: ผลลัพธ์ยังไม่ลากของจากข้างนอกใช่ไหม ----
        problem = _layer.external_problem(out)
        if problem:
            die(u"ผลลัพธ์หลังรวม: " + problem + u"\n    index.html ยังไม่ถูกแตะ")

        # ---- ผ่านหมด เขียนจริง ----
        before = len(read(LIVE))
        io.open(LIVE, "w", encoding="utf-8").write(out)
        shutil.copyfile(new_src, BASE)

        print(u"✅ รวมเรียบร้อย")
        print(u"   index.html             %s → %s ไบต์" % (format(before, ","), format(len(out), ",")))
        print(u"   upstream/klong-pro.html อัปเดตเป็นรุ่นใหม่แล้ว (ใช้เป็นจุดอ้างอิงรอบหน้า)")
        print(u"   ชั้นเว็บแอปครบ · ไม่มีของจากข้างนอก")
        print(u"\n   ต่อไป: node tools/smoke-test.js  แล้วค่อย commit")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
