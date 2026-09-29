import { Link } from 'expo-router';
import { Text, View } from 'react-native';

export default function NotFound() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Text style={{ fontSize: 18, fontWeight: '700' }}>Screen not found</Text>
      <Link href="/(tabs)" style={{ marginTop: 12, color: '#0E9F6E', fontWeight: '600' }}>
        Go home
      </Link>
    </View>
  );
}
