import { Text } from 'react-native';
import { Tabs } from 'expo-router';
import { C } from '../../components/theme';

function TabIcon({ glyph, focused }: { glyph: string; focused: boolean }) {
  return <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.55 }}>{glyph}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.emeraldDark,
        tabBarInactiveTintColor: C.inkFaint,
        tabBarStyle: { backgroundColor: '#fff', borderTopColor: C.line, height: 64, paddingBottom: 10, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 11.5, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarIcon: ({ focused }) => <TabIcon glyph="🏠" focused={focused} /> }}
      />
      <Tabs.Screen
        name="udhaar"
        options={{ title: 'Udhaar', tabBarIcon: ({ focused }) => <TabIcon glyph="🤝" focused={focused} /> }}
      />
      <Tabs.Screen
        name="expenses"
        options={{ title: 'Expenses', tabBarIcon: ({ focused }) => <TabIcon glyph="🧾" focused={focused} /> }}
      />
      <Tabs.Screen
        name="stats"
        options={{ title: 'Stats', tabBarIcon: ({ focused }) => <TabIcon glyph="📊" focused={focused} /> }}
      />
    </Tabs>
  );
}
