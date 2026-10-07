package th.kruta.widget;

import android.content.Context;
import android.content.res.ColorStateList;
import android.widget.RemoteViews;

/** ธีมสีวิดเจ็ต · "auto" ใช้สีจาก resource (สลับกลางวัน/กลางคืนตามเครื่องเอง) ที่เหลือกำหนดสีตายตัว */
final class Theme {
    final String key, label;
    final boolean auto, dark;
    final int bg, ink, muted, accent, onAccent;

    private Theme(String key, String label, boolean dark, int bg, int ink, int muted, int accent, int onAccent) {
        this.key = key; this.label = label; this.auto = "auto".equals(key); this.dark = dark;
        this.bg = bg; this.ink = ink; this.muted = muted; this.accent = accent; this.onAccent = onAccent;
    }

    static final Theme[] ALL = {
        new Theme("auto",  "ตามเครื่อง (กลางวัน/กลางคืน)", false, 0, 0, 0, 0, 0),
        new Theme("cream", "ครีมเหลือง",    false, 0xFFFFFDF5, 0xFF111111, 0xFF5A5A5A, 0xFFFFD93D, 0xFF111111),
        new Theme("night", "กลางคืน",       true,  0xFF16140F, 0xFFF0E9DA, 0xFFB5AC9A, 0xFFFFD93D, 0xFF111111),
        new Theme("pink",  "ชมพูพาสเทล",    false, 0xFFFFF0F5, 0xFF2A1520, 0xFF7A5866, 0xFFFF8FB1, 0xFF2A1520),
        new Theme("sky",   "ฟ้าทะเล",       false, 0xFFEEF6FF, 0xFF0E1E33, 0xFF4A6380, 0xFF7CC4FF, 0xFF0E1E33),
        new Theme("mint",  "มิ้นต์",         false, 0xFFEFFBF4, 0xFF0F2A1C, 0xFF4C6E5B, 0xFF6EE7A8, 0xFF0F2A1C),
        new Theme("lav",   "ม่วงลาเวนเดอร์", false, 0xFFF5F0FF, 0xFF1E1433, 0xFF685A80, 0xFFC4B5FD, 0xFF1E1433),
        new Theme("ink",   "ดำ + แดง",       true,  0xFF000000, 0xFFFFFFFF, 0xFFAAAAAA, 0xFFFF6B6B, 0xFF000000),
    };

    static Theme of(Context c) {
        String k = Store.prefs(c).getString("theme", "auto");
        for (Theme t : ALL) if (t.key.equals(k)) return t;
        return ALL[0];
    }

    // บทบาทของสี → resource (ใช้ตอน auto)
    static final int INK = 0, MUTED = 1, ON_ACCENT = 2, OK = 3, WAIT = 4, OFF = 5;
    private static final int[] RES = { R.color.ink, R.color.muted, R.color.on_yel, R.color.ok, R.color.wait, R.color.off };

    int fixed(int role) {
        switch (role) {
            case INK: return ink;
            case MUTED: return muted;
            case ON_ACCENT: return onAccent;
            case OK: return dark ? 0xFF5EE08F : 0xFF15803D;
            case WAIT: return dark ? 0xFFF5C842 : 0xFF8A5A00;
            default: return dark ? 0xFF8F8776 : 0xFF8A8A8A;
        }
    }

    void text(RemoteViews v, int viewId, int role) {
        if (auto) v.setColor(viewId, "setTextColor", RES[role]);
        else v.setTextColor(viewId, fixed(role));
    }

    /** ย้อมพื้น (shape ยังคงมุมโค้งเดิม) — auto ไม่ต้องทำอะไร เพราะ drawable ใช้สีจาก resource อยู่แล้ว */
    void tint(RemoteViews v, int viewId, int color) {
        if (!auto) v.setColorStateList(viewId, "setBackgroundTintList", ColorStateList.valueOf(color));
    }

    void apply(RemoteViews v) {
        tint(v, android.R.id.background, bg);
        tint(v, R.id.next_fill, accent);
        tint(v, R.id.next_box, onAccent);
        tint(v, R.id.chip, accent);
        text(v, R.id.chip, ON_ACCENT);
        text(v, R.id.summary, MUTED);
        text(v, R.id.refresh, INK);
        for (int id : new int[] { R.id.label, R.id.time, R.id.name, R.id.place }) text(v, id, ON_ACCENT);
    }
}
