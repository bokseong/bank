plugins { id("com.android.application"); id("org.jetbrains.kotlin.android"); id("com.google.gms.google-services") }

android { namespace = "kr.hsbokseong.bankcollector"; compileSdk = 35
  defaultConfig { applicationId = "kr.hsbokseong.bankcollector"; minSdk = 26; targetSdk = 35; versionCode = 1; versionName = "1.0.0" }
}
dependencies {
  implementation(platform("com.google.firebase:firebase-bom:34.7.0"))
  implementation("com.google.firebase:firebase-auth")
  implementation("com.google.firebase:firebase-functions")
  implementation("com.google.firebase:firebase-appcheck-playintegrity")
  implementation("androidx.core:core-ktx:1.15.0")
  implementation("androidx.appcompat:appcompat:1.7.0")
  implementation("androidx.work:work-runtime-ktx:2.10.0")
}
