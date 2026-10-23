import { useEffect, useRef } from 'react';
import { Animated, Image, View } from 'react-native';
import { C } from './theme';

/**
 * Floating brand badge for the Home screen (owner-provided artwork,
 * used exactly as supplied — assets/floating-wallet.png).
 *
 * The badge floats continuously: a gentle vertical bob with a very
 * subtle scale "breathing", both on the native driver so it costs
 * nothing on the JS thread. Theme grading is presentation-only —
 * a gold ring and an emerald glow that tie the artwork into the
 * Pocket Pop palette without touching a single pixel of the art.
 */
const ART = require('../assets/floating-wallet.png');

export default function FloatingLogo({ size = 78 }: { size?: number }) {
  const bob = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 2100, useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 2100, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bob]);

  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -9] });
  const scale = bob.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        right: 16,
        bottom: 96, // floats just above the tab dock
        transform: [{ translateY }, { scale }],
        shadowColor: C.emerald,
        shadowOpacity: 0.55,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 6 },
        elevation: 12,
      }}
    >
      <View
        style={{
          width: size,
          height: size,
          borderRadius: 22,
          borderWidth: 2.5,
          borderColor: C.gold,
          overflow: 'hidden',
          backgroundColor: '#010805',
        }}
      >
        <Image source={ART} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
      </View>
    </Animated.View>
  );
}
