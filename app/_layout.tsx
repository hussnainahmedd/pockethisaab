import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initDatabase } from '../lib/db';
import { runAutofetch } from '../lib/autofetch/service';
import { C } from '../components/theme';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    initDatabase()
      .then(() => {
        setReady(true);
        // Fire-and-forget: import any new bank/wallet transactions.
        runAutofetch().catch(() => {});
      })
      .catch((e) => setError(String(e)));

    // Re-run when the app comes back to the foreground (e.g. user granted
    // Notification Access in system settings and returned).
    const sub = AppState.addEventListener('change', (next) => {
      if (appState.current.match(/inactive|background/) && next === 'active') {
        runAutofetch().catch(() => {});
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, []);

  if (error) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: C.bg }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: C.red }}>Could not open local database</Text>
          <Text style={{ marginTop: 8, color: C.inkSoft, textAlign: 'center' }}>{error}</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  if (!ready) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg }}>
          <ActivityIndicator size="large" color={C.emerald} />
          <Text style={{ marginTop: 12, color: C.inkSoft, fontWeight: '600' }}>Opening your hisaab…</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.ink,
          headerTitleStyle: { fontWeight: '700' },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="add-expense" options={{ presentation: 'modal', title: 'Add Expense' }} />
        <Stack.Screen name="add-income" options={{ presentation: 'modal', title: 'Add Pocket Money' }} />
        <Stack.Screen name="add-udhaar" options={{ presentation: 'modal', title: 'New Udhaar Entry' }} />
        <Stack.Screen name="person/[name]" options={{ title: 'Person' }} />
        <Stack.Screen name="income-list" options={{ title: 'Pocket Money' }} />
        <Stack.Screen name="edit-income" options={{ presentation: 'modal', title: 'Edit Entry' }} />
        <Stack.Screen name="edit-expense" options={{ presentation: 'modal', title: 'Edit Expense' }} />
        <Stack.Screen name="edit-udhaar" options={{ presentation: 'modal', title: 'Edit Udhaar' }} />
        <Stack.Screen name="autofetch-settings" options={{ title: 'Auto-fetch ⚡' }} />
        <Stack.Screen name="+not-found" />
      </Stack>
    </SafeAreaProvider>
  );
}
