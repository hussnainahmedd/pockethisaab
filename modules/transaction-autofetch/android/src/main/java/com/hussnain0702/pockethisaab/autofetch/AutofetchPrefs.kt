package com.hussnain0702.pockethisaab.autofetch

import android.content.Context

/**
 * Preferences for the transaction auto-fetch native components.
 *
 * - notification_packages: finance apps the notification listener reads.
 * - sms_senders: coarse sender pre-filter for the SMS receiver (normalized
 *   substrings like "8558", "JAZZCASH"). The JS side still applies the exact
 *   sender rules + template parsing; this just keeps personal SMS from ever
 *   being written to the disk queue.
 * - sms_enabled / notif_enabled: channel toggles, synced from the JS
 *   settings UI. Both default to false so nothing is captured until the
 *   user explicitly enables auto-fetch in the app.
 */
object AutofetchPrefs {
  private const val PREFS = "transaction_autofetch"
  private const val KEY_PACKAGES = "notification_packages"
  private const val KEY_SMS_SENDERS = "sms_senders"
  private const val KEY_SMS_ENABLED = "sms_enabled"
  private const val KEY_NOTIF_ENABLED = "notif_enabled"

  val DEFAULT_PACKAGES: Set<String> = setOf(
    "com.nayapay.app", // NayaPay (verified Play listing id)
    "com.sadapay.app", // SadaPay (candidate ids — harmless if absent)
    "pk.com.sadapay",
    "com.finja.consumer", // Finja (candidate ids — harmless if absent)
    "com.finja.app",
    "com.avanza.ambitwizfbl", // Faysal DigiBank (verified Play listing id)
  )

  private fun prefs(context: Context) =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun getStringSet(context: Context, key: String, default: Set<String>): Set<String> {
    return try {
      val raw = prefs(context).getString(key, null) ?: return default
      raw.split(",").map { it.trim() }.filter { it.isNotEmpty() }.toSet()
        .ifEmpty { default }
    } catch (_: Exception) {
      default
    }
  }

  private fun setStringSet(context: Context, key: String, values: Set<String>) {
    try {
      prefs(context).edit().putString(key, values.joinToString(",")).apply()
    } catch (_: Exception) {
      // ignore — component keeps using the previous list
    }
  }

  private fun getBool(context: Context, key: String, default: Boolean): Boolean {
    return try {
      prefs(context).getBoolean(key, default)
    } catch (_: Exception) {
      default
    }
  }

  private fun setBool(context: Context, key: String, value: Boolean) {
    try {
      prefs(context).edit().putBoolean(key, value).apply()
    } catch (_: Exception) {
      // ignore
    }
  }

  // Notification packages (existing behavior)
  fun getPackages(context: Context): Set<String> =
    getStringSet(context, KEY_PACKAGES, DEFAULT_PACKAGES)

  fun setPackages(context: Context, packages: Set<String>) =
    setStringSet(context, KEY_PACKAGES, packages)

  // SMS sender pre-filter
  fun getSmsSenders(context: Context): Set<String> =
    getStringSet(context, KEY_SMS_SENDERS, emptySet())

  fun setSmsSenders(context: Context, senders: Set<String>) =
    setStringSet(context, KEY_SMS_SENDERS, senders)

  /**
   * Coarse pre-filter: normalize the address (uppercase, alphanumeric only)
   * and check whether it contains any allowed sender pattern. The JS side
   * applies the exact rules afterwards; this only decides whether the raw
   * SMS is worth writing to the queue at all.
   */
  fun isSenderAllowed(context: Context, address: String): Boolean {
    val allowed = getSmsSenders(context)
    if (allowed.isEmpty()) return false
    val norm = address.uppercase().filter { it.isLetterOrDigit() }
    if (norm.isEmpty()) return false
    return allowed.any { pattern ->
      val p = pattern.uppercase().filter { it.isLetterOrDigit() }
      p.isNotEmpty() && norm.contains(p)
    }
  }

  // Channel toggles
  fun isSmsEnabled(context: Context): Boolean =
    getBool(context, KEY_SMS_ENABLED, false)

  fun setSmsEnabled(context: Context, enabled: Boolean) =
    setBool(context, KEY_SMS_ENABLED, enabled)

  fun isNotifEnabled(context: Context): Boolean =
    getBool(context, KEY_NOTIF_ENABLED, false)

  fun setNotifEnabled(context: Context, enabled: Boolean) =
    setBool(context, KEY_NOTIF_ENABLED, enabled)
}
