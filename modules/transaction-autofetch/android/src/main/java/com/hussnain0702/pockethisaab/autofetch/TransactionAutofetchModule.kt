package com.hussnain0702.pockethisaab.autofetch

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS bridge for the transaction auto-fetch feature.
 * Only three native capabilities are needed — everything else
 * (parsing, dedup, ledger writes) lives in JS:
 *  1. getInboxSms — query the SMS inbox for messages newer than a timestamp
 *     (used for first-run history import + catch-up scans).
 *  2. isNotificationListenerEnabled / openNotificationListenerSettings —
 *     Notification Access is a Settings toggle, not a runtime permission.
 *  3. getQueueDirPath / setNotificationPackages — plumbing for the disk
 *     queue written by the SMS receiver + notification listener.
 */
class TransactionAutofetchModule : Module() {
  override fun definition() =
    ModuleDefinition {
      Name("TransactionAutofetch")

      AsyncFunction("getInboxSms") { since: Double, maxCount: Double, promise: Promise ->
        try {
          val context = appContext.reactContext ?: throw Exception("No React context")
          if (
            context.checkSelfPermission(Manifest.permission.READ_SMS) !=
              PackageManager.PERMISSION_GRANTED
          ) {
            throw SecurityException("READ_SMS permission not granted")
          }
          val limit = maxCount.toInt().coerceIn(1, 1000)
          val cursor =
            context.contentResolver.query(
              Uri.parse("content://sms/inbox"),
              arrayOf("address", "body", "date"),
              "date > ?",
              arrayOf(since.toLong().toString()),
              "date DESC",
            ) ?: throw Exception("SMS inbox query returned null")
          val out = ArrayList<Map<String, Any?>>()
          cursor.use {
            val iAddr = it.getColumnIndexOrThrow("address")
            val iBody = it.getColumnIndexOrThrow("body")
            val iDate = it.getColumnIndexOrThrow("date")
            while (it.moveToNext() && out.size < limit) {
              out.add(
                mapOf(
                  "address" to (it.getString(iAddr) ?: ""),
                  "body" to (it.getString(iBody) ?: ""),
                  "date" to it.getLong(iDate).toDouble(),
                ),
              )
            }
          }
          promise.resolve(out)
        } catch (e: Exception) {
          promise.reject("SMS_QUERY_FAILED", e.message ?: "unknown error", e)
        }
      }

      Function("isNotificationListenerEnabled") {
        val context = appContext.reactContext ?: return@Function false
        val flat =
          Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")
            ?: return@Function false
        // Entries look like "pkg/.ServiceClass:pkg2/.ServiceClass"
        flat.split(":").any { component ->
          component.substringBefore("/").equals(context.packageName, ignoreCase = true)
        }
      }

      Function("openNotificationListenerSettings") {
        val context = appContext.reactContext ?: return@Function false
        val intent =
          Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        true
      }

      Function("getQueueDirPath") {
        val context = appContext.reactContext ?: return@Function ""
        AutofetchQueue.queueDirPath(context)
      }

      Function("setNotificationPackages") { packages: List<String> ->
        val context = appContext.reactContext ?: return@Function false
        AutofetchPrefs.setPackages(context, packages.toSet())
        true
      }

      /** Overwrite the coarse SMS sender pre-filter (normalized substrings). */
      Function("setSmsSenders") { senders: List<String> ->
        val context = appContext.reactContext ?: return@Function false
        AutofetchPrefs.setSmsSenders(context, senders.toSet())
        true
      }

      /** Sync the SMS channel toggle so the receiver stops capturing when off. */
      Function("setSmsChannelEnabled") { enabled: Boolean ->
        val context = appContext.reactContext ?: return@Function false
        AutofetchPrefs.setSmsEnabled(context, enabled)
        true
      }

      /** Sync the notification channel toggle so the listener stops when off. */
      Function("setNotifChannelEnabled") { enabled: Boolean ->
        val context = appContext.reactContext ?: return@Function false
        AutofetchPrefs.setNotifEnabled(context, enabled)
        true
      }
    }
}
