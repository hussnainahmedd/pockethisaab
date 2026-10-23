import { Text, View } from 'react-native';
import { Tabs } from 'expo-router';
import { C } from '../../components/theme';

function TabIcon({ glyph, focused }: { glyph: string; focused: boolean }) {
  return (
    <View
      style={{
        width: 46,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: focused ? 'rgba(242,179,61,0.22)' : 'transparent',
      }}
    >
      <Text style={{ fontSize: 21, opacity: focused ? 1 : 0.55, transform: [{ scale: focused ? 1.1 : 1 }] }}>
        {glyph}
      </Text>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.gold,
        tabBarInactiveTintColor: 'rgba(255,255,255,0.55)',
        tabBarStyle: {
          // Pocket Pop floating dock (M5): deep ink pill floating above
          // the content. Every scroll surface pads ≥118 at the bottom.
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 14,
          height: 68,
          borderRadius: 24,
          borderTopWidth: 0,
          backgroundColor: C.ink,
          paddingBottom: 8,
          paddingTop: 8,
          shadowColor: '#101D15',
          shadowOpacity: 0.35,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
          elevation: 14,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '800' },
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
