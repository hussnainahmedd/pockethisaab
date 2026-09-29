import { Text } from 'react-native';
import { Tabs } from 'expo-router';
import { C } from '../../components/theme';

function TabIcon({ glyph, focused }: { glyph: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: 23, opacity: focused ? 1 : 0.5, transform: [{ scale: focused ? 1.12 : 1 }] }}>
      {glyph}
    </Text>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.emeraldDark,
        tabBarInactiveTintColor: C.inkFaint,
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopColor: C.line,
          borderTopWidth: 1.5,
          height: 68,
          paddingBottom: 12,
          paddingTop: 8,
          shadowColor: '#0E9F6E',
          shadowOpacity: 0.15,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: -6 },
          elevation: 12,
        },
        tabBarLabelStyle: { fontSize: 11.5, fontWeight: '800' },
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
