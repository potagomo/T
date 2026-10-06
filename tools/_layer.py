# -*- coding: utf-8 -*-
"""ของที่ apply-webapp-layer.py กับ merge-upstream.py ใช้ร่วมกัน

แยกออกมาไว้ที่เดียวเพราะด่านสแกนของจากข้างนอกเป็นด่านสำคัญที่สุดของทั้งสองสคริปต์
ถ้าปล่อยให้เขียนซ้ำสองที่ วันหนึ่งจะแก้ที่เดียวแล้วอีกที่หลุด
"""
import re

# DTD ของ MusicXML โผล่เป็นข้อความในไฟล์ที่ส่งออก ไม่ได้ถูกโหลดจริง จึงไม่นับ
_ALLOWED_PREFIXES = ("http://www.musicxml.org/",)

_URL_IN_ATTR = re.compile(r'(?:src|href)\s*=\s*["\'](https?://[^"\']+)["\']', re.I)


def scan_external(html):
    """คืนรายการ URL ภายนอกที่หน้าเว็บจะพยายามโหลด (เรียงแล้ว)

    ทำไมต้องมี: CSP ของเราเป็น default-src 'self' ของจากข้างนอกจะถูกบล็อก
    **เงียบ ๆ ไม่มี error ให้เห็น** หน้าเว็บพังแบบหาสาเหตุไม่เจอ
    จับตรงนี้ก่อน push ถูกกว่าไปนั่งไล่หาทีหลังมาก
    """
    found = set()
    for m in _URL_IN_ATTR.finditer(html):
        u = m.group(1)
        if not u.startswith(_ALLOWED_PREFIXES):
            found.add(u)
    return sorted(found)


def external_problem(html):
    """คืนข้อความอธิบายปัญหา ถ้าไม่มีของจากข้างนอกเลยคืน None"""
    ext = scan_external(html)
    if not ext:
        return None
    return (u"ไฟล์นี้ดึงของจากข้างนอก %d รายการ CSP จะบล็อกทิ้งเงียบ ๆ:\n     " % len(ext)
            + u"\n     ".join(ext)
            + u"\n     → ต้องย้ายมาเก็บในโปรเจกต์ หรือผ่อน CSP อย่างจงใจ")


def new_external_problem(new_html, base_html):
    """จับเฉพาะของจากข้างนอกที่ "เพิ่มเข้ามาใหม่" เทียบกับรุ่นก่อนหน้า

    ทำไมไม่จับทั้งหมด: ไฟล์ดิบจากผู้พัฒนามีลิงก์ Google Fonts ติดมาเสมอ
    ซึ่งเป็นของเดิมและถูกตัดทิ้งตอน merge อยู่แล้ว (ฝั่งเราลบไปแล้ว ฝั่งเขาไม่ได้แตะ)
    ถ้าจับทั้งหมดจะเตือนผิดทุกรอบจนคนเลิกอ่านคำเตือน ซึ่งอันตรายกว่าไม่เตือน

    ของที่ต้องจับจริงคือลิงก์ใหม่ที่ผู้พัฒนาเพิ่งใส่เข้ามา เช่น CDN ของไลบรารี
    เพราะอันนั้นจะรอดจาก merge แล้วไปโดน CSP บล็อกเงียบ ๆ บนเว็บจริง
    """
    added = sorted(set(scan_external(new_html)) - set(scan_external(base_html)))
    if not added:
        return None
    return (u"ไฟล์ใหม่เพิ่มของจากข้างนอกเข้ามา %d รายการ CSP จะบล็อกทิ้งเงียบ ๆ:\n     " % len(added)
            + u"\n     ".join(added)
            + u"\n     → ต้องย้ายมาเก็บในโปรเจกต์ หรือผ่อน CSP อย่างจงใจ")
