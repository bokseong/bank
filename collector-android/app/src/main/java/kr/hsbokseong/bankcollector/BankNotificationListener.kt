package kr.hsbokseong.bankcollector

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.provider.Settings
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.google.android.gms.tasks.Tasks
import com.google.firebase.functions.FirebaseFunctions
import java.util.UUID
import java.util.concurrent.Executors

data class DepositEvent(val deviceId: String, val notificationKey: String, val sourcePackage: String, val receivedAt: Long, val amount: Long, val senderName: String, val nonce: String, val signature: String)

class BankNotificationListener : NotificationListenerService() {
  private val executor = Executors.newSingleThreadExecutor()
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    val allowed = CollectorPreferences.allowedPackages(this)
    if (!allowed.contains(sbn.packageName)) return
    val extras = sbn.notification.extras
    val body = listOf(extras.getCharSequence(Notification.EXTRA_TITLE), extras.getCharSequence(Notification.EXTRA_TEXT), extras.getCharSequence(Notification.EXTRA_BIG_TEXT)).filterNotNull().joinToString(" ")
    val amount = parseAmount(body) ?: return
    val sender = parseSender(body)
    val deviceId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)
    val nonce = UUID.randomUUID().toString()
    val canonical = listOf(deviceId, sbn.key, sbn.packageName, sbn.postTime, amount, sender, nonce).joinToString("|")
    val event = DepositEvent(deviceId, sbn.key, sbn.packageName, sbn.postTime, amount, sender, nonce, DeviceKeys.sign(canonical))
    executor.execute { uploadOrQueue(event) }
  }
  private fun uploadOrQueue(event: DepositEvent) {
    val map = hashMapOf<String, Any>("deviceId" to event.deviceId, "notificationKey" to event.notificationKey, "sourcePackage" to event.sourcePackage, "receivedAt" to event.receivedAt, "amount" to event.amount, "senderName" to event.senderName, "nonce" to event.nonce, "signature" to event.signature)
    try { Tasks.await(FirebaseFunctions.getInstance("asia-northeast3").getHttpsCallable("ingestDepositNotification").call(hashMapOf("event" to map))) }
    catch (_: Exception) { WorkManager.getInstance(this).enqueueUniqueWork("deposit-${event.notificationKey.hashCode()}-${event.receivedAt}", ExistingWorkPolicy.KEEP, OneTimeWorkRequestBuilder<DepositUploadWorker>().setInputData(DepositUploadWorker.data(event)).build()) }
  }
  private fun parseAmount(text: String): Long? {
    val patterns = listOf(Regex("입금[^0-9]{0,30}([0-9,]+)원"), Regex("([0-9,]+)원\\s*입금"), Regex("받음[^0-9]{0,30}([0-9,]+)원"))
    return patterns.firstNotNullOfOrNull { it.find(text)?.groupValues?.getOrNull(1)?.replace(",", "")?.toLongOrNull() }
  }
  private fun parseSender(text: String): String = Regex("(?:입금자|보낸 분|보낸사람)\\s*[:：]?\\s*([가-힣A-Za-z0-9*]{2,40})").find(text)?.groupValues?.getOrNull(1) ?: ""
}
