package com.hussnain0702.pockethisaab.autofetch

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.telephony.SmsMessage

/**
 * Manifest-registered receiver for incoming SMS. Runs even when the app UI
 * is dead — the system starts our process to deliver the broadcast.
 *
 * Privacy: an SMS is queued ONLY if the SMS channel is enabled in the app
 * settings AND the sender passes the native pre-filter (known bank/wallet
 * sender patterns synced from JS). Everything else is ignored without ever
 * touching disk — personal messages never enter the app.
 */
class TransactionSmsReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    try {
      if (intent.action != "android.provider.Telephony.SMS_RECEIVED") return
      val appContext = context.applicationContext
      // Channel off → ignore everything.
      if (!AutofetchPrefs.isSmsEnabled(appContext)) return
      val pdus = intent.extras?.get("pdus") as? Array<*> ?: return
      val format = intent.extras?.getString("format")

      data class Part(val address: String, val body: String, val ts: Long)

      val parts = pdus.mapNotNull { pdu ->
        try {
          val bytes = pdu as? ByteArray ?: return@mapNotNull null
          val msg =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
              SmsMessage.createFromPdu(bytes, format)
            } else {
              @Suppress("DEPRECATION") SmsMessage.createFromPdu(bytes)
            }
          val addr = msg.displayOriginatingAddress ?: return@mapNotNull null
          Part(addr, msg.messageBody ?: "", msg.timestampMillis)
        } catch (_: Exception) {
          null
        }
      }

      // Concatenate multipart segments per sender.
      parts.groupBy { it.address }.forEach { (address, segs) ->
        // Sender not on the bank/wallet pre-filter → ignore, never queued.
        if (!AutofetchPrefs.isSenderAllowed(appContext, address)) return@forEach
        val body = segs.joinToString("") { it.body }
        val ts = segs.maxOf { it.ts }
        if (body.isNotBlank()) {
          AutofetchQueue.writeSms(appContext, address, body, ts)
        }
      }
    } catch (_: Exception) {
      // Never crash on a system broadcast.
    }
  }
}
