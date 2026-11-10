package kr.hsbokseong.bankcollector

import android.content.Context
import androidx.work.Data
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.google.firebase.functions.FirebaseFunctions

class DepositUploadWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  override fun doWork(): Result {
    val event = hashMapOf<String, Any>("deviceId" to inputData.getString("deviceId")!!, "notificationKey" to inputData.getString("notificationKey")!!, "sourcePackage" to inputData.getString("sourcePackage")!!, "receivedAt" to inputData.getLong("receivedAt", 0), "amount" to inputData.getLong("amount", 0), "senderName" to inputData.getString("senderName")!!, "nonce" to inputData.getString("nonce")!!, "signature" to inputData.getString("signature")!!)
    return try { com.google.android.gms.tasks.Tasks.await(FirebaseFunctions.getInstance("asia-northeast3").getHttpsCallable("ingestDepositNotification").call(hashMapOf("event" to event))); Result.success() } catch (_: Exception) { Result.retry() }
  }
  companion object { fun data(event: DepositEvent) = Data.Builder().putString("deviceId", event.deviceId).putString("notificationKey", event.notificationKey).putString("sourcePackage", event.sourcePackage).putLong("receivedAt", event.receivedAt).putLong("amount", event.amount).putString("senderName", event.senderName).putString("nonce", event.nonce).putString("signature", event.signature).build() }
}
