package kr.hsbokseong.bankcollector

import android.content.Context

object CollectorPreferences {
  private const val FILE = "collector_settings"; private const val PACKAGES = "allowed_packages"
  fun allowedPackages(context: Context): Set<String> = context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(PACKAGES, "")!!.split(',').map { it.trim() }.filter { it.isNotEmpty() }.toSet()
  fun savePackages(context: Context, value: String) { context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString(PACKAGES, value).apply() }
  fun packageText(context: Context): String = context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(PACKAGES, "")!!
}
