package com.hussnain0702.pockethisaab.autofetch

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.util.UUID

/**
 * Disk queue for transaction events captured while the JS engine isn't
 * running (app killed / in background). The SMS BroadcastReceiver and the
 * NotificationListenerService append one JSON file per event; the JS side
 * drains the directory on every app launch and deletes what it processed.
 * File-per-event keeps writes atomic and avoids any locking.
 */
object AutofetchQueue {
  private const val DIR_NAME = "autofetch-queue"

  fun queueDir(context: Context): File {
    val dir = File(context.filesDir, DIR_NAME)
    if (!dir.exists()) dir.mkdirs()
    return dir
  }

  fun queueDirPath(context: Context): String = queueDir(context).absolutePath

  private fun write(context: Context, obj: JSONObject) {
    try {
      val dir = queueDir(context)
      val name = "${System.currentTimeMillis()}-${UUID.randomUUID()}.json"
      File(dir, name).writeText(obj.toString())
    } catch (_: Exception) {
      // Never crash the host app from a background component.
    }
  }

  fun writeSms(context: Context, address: String, body: String, date: Long) {
    write(
      context,
      JSONObject()
        .put("type", "sms")
        .put("address", address)
        .put("body", body)
        .put("date", date),
    )
  }

  fun writeNotification(
    context: Context,
    packageName: String,
    title: String,
    text: String,
    postTime: Long,
  ) {
    write(
      context,
      JSONObject()
        .put("type", "notification")
        .put("packageName", packageName)
        .put("title", title)
        .put("text", text)
        .put("postTime", postTime),
    )
  }
}
