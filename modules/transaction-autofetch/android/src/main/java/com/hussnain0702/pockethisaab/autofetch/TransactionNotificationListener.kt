package com.hussnain0702.pockethisaab.autofetch

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Listens for push notifications from finance apps (SadaPay, NayaPay,
 * Finja, …) that don't send transaction SMS. Only packages on the
 * allowlist are read; everything else is ignored. Runs as a system-bound
 * service, so it captures notifications even when the app UI is closed —
 * events go to the disk queue for the JS side to drain on next launch.
 */
class TransactionNotificationListener : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    try {
      // Channel off → ignore everything, even with system access granted.
      if (!AutofetchPrefs.isNotifEnabled(this)) return
      val pkg = sbn.packageName ?: return
      if (pkg == packageName) return // never read our own notifications
      if (!AutofetchPrefs.getPackages(this).contains(pkg)) return

      val extras = sbn.notification?.extras ?: return
      val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
      val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()
      val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString().orEmpty()
      val body = listOf(text, bigText).filter { it.isNotBlank() }.joinToString("\n").trim()
      if (body.isBlank() && title.isBlank()) return

      AutofetchQueue.writeNotification(
        applicationContext,
        pkg,
        title,
        body.ifBlank { title },
        sbn.postTime,
      )
    } catch (_: Exception) {
      // Never crash the listener service.
    }
  }
}
