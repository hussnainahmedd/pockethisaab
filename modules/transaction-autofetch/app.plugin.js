/**
 * Expo config plugin for the transaction-autofetch local module.
 *
 * Injects into the generated AndroidManifest.xml (at `expo prebuild` time,
 * which EAS Build runs):
 *  - READ_SMS + RECEIVE_SMS permissions
 *  - TransactionSmsReceiver  (SMS_RECEIVED broadcast)
 *  - TransactionNotificationListener (NotificationListenerService)
 *
 * The Kotlin sources live in ./android/src/... and are compiled via the
 * module's own build.gradle (autolinked).
 */
const { withAndroidManifest } = require('@expo/config-plugins');

const PKG = 'com.hussnain0702.pockethisaab.autofetch';
const RECEIVER = `${PKG}.TransactionSmsReceiver`;
const LISTENER = `${PKG}.TransactionNotificationListener`;

function ensurePermission(manifest, name) {
  manifest['uses-permission'] = manifest['uses-permission'] || [];
  const perms = manifest['uses-permission'];
  if (!perms.some((p) => p && p.$ && p.$['android:name'] === name)) {
    perms.push({ $: { 'android:name': name } });
  }
}

function withTransactionAutofetch(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    ensurePermission(manifest, 'android.permission.READ_SMS');
    ensurePermission(manifest, 'android.permission.RECEIVE_SMS');

    const app = manifest.application && manifest.application[0];
    if (!app) return cfg;

    app.receiver = app.receiver || [];
    if (!app.receiver.some((r) => r.$ && r.$['android:name'] === RECEIVER)) {
      app.receiver.push({
        $: { 'android:name': RECEIVER, 'android:exported': 'true' },
        'intent-filter': [
          {
            $: { 'android:priority': '999' },
            action: [{ $: { 'android:name': 'android.provider.Telephony.SMS_RECEIVED' } }],
          },
        ],
      });
    }

    app.service = app.service || [];
    if (!app.service.some((s) => s.$ && s.$['android:name'] === LISTENER)) {
      app.service.push({
        $: {
          'android:name': LISTENER,
          'android:permission': 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE',
          'android:exported': 'true',
        },
        'intent-filter': [
          {
            action: [
              { $: { 'android:name': 'android.service.notification.NotificationListenerService' } },
            ],
          },
        ],
      });
    }

    return cfg;
  });
}

module.exports = withTransactionAutofetch;
