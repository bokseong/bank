package kr.hsbokseong.bankcollector

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature

object DeviceKeys {
  private const val ALIAS = "bank_collector_signing_key"
  private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
  private fun ensureKey() {
    if (keyStore().containsAlias(ALIAS)) return
    KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
      initialize(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
        .setDigests(KeyProperties.DIGEST_SHA256).setUserAuthenticationRequired(false).build()); generateKeyPair()
    }
  }
  fun publicKeySpki(): String { ensureKey(); return Base64.encodeToString(keyStore().getCertificate(ALIAS).publicKey.encoded, Base64.NO_WRAP) }
  fun sign(message: String): String { ensureKey(); return Signature.getInstance("SHA256withECDSA").run { initSign(keyStore().getKey(ALIAS, null) as java.security.PrivateKey); update(message.toByteArray(Charsets.UTF_8)); Base64.encodeToString(sign(), Base64.NO_WRAP) } }
}
