package kr.hsbokseong.bankcollector

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import com.google.firebase.auth.FirebaseAuth

class MainActivity : AppCompatActivity() {
  private fun field(hint: String, value: String = "", password: Boolean = false) = EditText(this).apply { this.hint = hint; setText(value); inputType = if (password) InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD else InputType.TYPE_CLASS_TEXT }
  override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(savedInstanceState)
    val pad = (20 * resources.displayMetrics.density).toInt()
    val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad, pad, pad); gravity = Gravity.CENTER_HORIZONTAL }
    val status = TextView(this).apply { text = "학생회 전용 수집기\n수집기 UID와 공개키를 관리자에게 등록한 뒤에만 입금 알림을 전송할 수 있습니다." }
    val email = field("수집기 Firebase 이메일"), password = field("비밀번호", password = true), packages = field("허용 은행 앱 package name (쉼표 구분)", CollectorPreferences.packageText(this))
    val device = TextView(this).apply { text = "기기 ID: ${Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)}\n공개키(SPKI): ${DeviceKeys.publicKeySpki()}"; textIsSelectable = true }
    val login = Button(this).apply { text = "수집기 로그인 및 설정 저장"; setOnClickListener {
      CollectorPreferences.savePackages(this@MainActivity, packages.text.toString())
      FirebaseAuth.getInstance().signInWithEmailAndPassword(email.text.toString().trim(), password.text.toString()).addOnSuccessListener { status.text = "로그인 완료. 알림 접근 권한을 허용해 주세요." }.addOnFailureListener { status.text = "로그인 실패: ${it.localizedMessage}" }
    } }
    val permission = Button(this).apply { text = "알림 접근 권한 열기"; setOnClickListener { startActivity(Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")) } }
    listOf(status, email, password, packages, login, permission, device).forEach { root.addView(it, LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT) }
    setContentView(ScrollView(this).apply { addView(root) })
  }
}
