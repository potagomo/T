package th.kruta.widget;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.graphics.Typeface;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** หน้าตั้งค่า: วางรหัสวิดเจ็ตจากแอปครูต้า แล้ววางวิดเจ็ตบนหน้าจอโฮม */
public class MainActivity extends Activity {
    private TextView status;
    private EditText code;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        int pad = (int) (22 * getResources().getDisplayMetrics().density);
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setPadding(pad, pad * 3, pad, pad * 2);

        TextView title = new TextView(this);
        title.setText("🥁 ครูต้า · วิดเจ็ต");
        title.setTextSize(24);
        title.setTypeface(null, Typeface.BOLD);
        l.addView(title);

        TextView how = new TextView(this);
        how.setText("\n1) แอปครูต้า › ⚙ › 🧩 วิดเจ็ตหน้าจอโฮม › คัดลอกรหัสวิดเจ็ต\n"
                + "2) กด \"วางจากคลิปบอร์ด\" แล้วกดบันทึก\n"
                + "3) กด \"➕ วางวิดเจ็ตบนหน้าจอโฮม\" หรือกดค้างที่หน้าจอโฮม › วิดเจ็ต › ครูต้า วิดเจ็ต\n");
        how.setTextSize(15);
        l.addView(how);

        code = new EditText(this);
        code.setHint("KRUTAW1:…");
        code.setSingleLine(false);
        code.setMinLines(2);
        l.addView(code);

        Button paste = new Button(this);
        paste.setText("วางจากคลิปบอร์ด");
        paste.setOnClickListener(x -> {
            ClipboardManager cm = getSystemService(ClipboardManager.class);
            ClipData d = cm != null ? cm.getPrimaryClip() : null;
            if (d != null && d.getItemCount() > 0) code.setText(d.getItemAt(0).coerceToText(this));
        });
        l.addView(paste);

        Button save = new Button(this);
        save.setText("บันทึก");
        save.setOnClickListener(x -> {
            if (Store.saveCode(this, code.getText().toString())) {
                status.setText("✓ บันทึกแล้ว · กำลังโหลดตารางสอน…");
                KrutaWidget.requestRefresh(this);
            } else {
                status.setText("✗ รหัสไม่ถูกต้อง — ต้องขึ้นต้นด้วย KRUTAW1: (คัดลอกจากแอปครูต้าใหม่อีกครั้ง)");
            }
        });
        l.addView(save);

        Button pin = new Button(this);
        pin.setText("➕ วางวิดเจ็ตบนหน้าจอโฮม");
        pin.setOnClickListener(x -> {
            AppWidgetManager m = getSystemService(AppWidgetManager.class);
            if (m != null && m.isRequestPinAppWidgetSupported()) {
                m.requestPinAppWidget(new ComponentName(this, KrutaWidget.class), null, null);
            } else {
                status.setText("เครื่องนี้วางให้อัตโนมัติไม่ได้ — กดค้างที่หน้าจอโฮม › วิดเจ็ต › ครูต้า วิดเจ็ต");
            }
        });
        l.addView(pin);

        status = new TextView(this);
        status.setTextSize(15);
        status.setPadding(0, pad, 0, 0);
        status.setGravity(Gravity.START);
        status.setText(Store.configured(this) ? "✓ ตั้งค่าแล้ว — เปลี่ยนรหัสได้โดยวางรหัสใหม่" : "ยังไม่ได้ตั้งค่า");
        l.addView(status);

        ScrollView sv = new ScrollView(this);
        sv.addView(l);
        setContentView(sv);
    }
}
