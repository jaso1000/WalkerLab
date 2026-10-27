// The one focusable surface every TV card is built on: a Pressable that the D-pad lands on, which
// scales up a little and takes a white outline while focused (the 10-foot convention - colour alone
// is too subtle across a room). Scale runs on the native driver, so holding a direction never waits
// on JS for the animation itself.
import React, { forwardRef, useRef, useState } from 'react';
import { Animated, Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { colors } from '../../src/theme/colors';

interface Props {
  children: React.ReactNode | ((focused: boolean) => React.ReactNode);
  style?: StyleProp<ViewStyle>;
  radius?: number;
  onPress?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Ask for focus when the screen first appears (Android TV's initial focus). */
  preferredFocus?: boolean;
  scale?: number;
  /** Android TV: the native view the D-pad's Down/Up goes to from here (a findNodeHandle result). */
  nextFocusDown?: number;
  nextFocusUp?: number;
  /**
   * Room around the card that Android counts as part of it when scrolling it into view (padding offset
   * by a negative margin, so layout is unchanged). A list scrolls only far enough to show the focused
   * view's own box, which would clip a scaled-up card's outline at the list's edge.
   */
  focusMargin?: number;
}

export const FocusCard = forwardRef<View, Props>(function FocusCard(
  { children, style, radius = 10, onPress, onFocus, onBlur, preferredFocus, scale = 1.06, nextFocusDown, nextFocusUp, focusMargin },
  ref
) {
  const [focused, setFocused] = useState(false);
  const anim = useRef(new Animated.Value(1)).current;

  const to = (value: number) =>
    Animated.timing(anim, { toValue: value, duration: 140, useNativeDriver: true }).start();

  return (
    <Pressable
      ref={ref}
      focusable
      hasTVPreferredFocus={preferredFocus}
      style={focusMargin ? { margin: -focusMargin, padding: focusMargin } : undefined}
      // View props Pressable passes through to its native view; missing from Pressable's own typings.
      // scrollSnapAlign: in a TV_LIST scroll view, focusing this card glides it to the middle (see ui.tsx).
      {...({ nextFocusDown, nextFocusUp, scrollSnapAlign: 'center' } as object)}
      onPress={onPress ?? (() => {})}
      onFocus={() => {
        setFocused(true);
        to(scale);
        onFocus?.();
      }}
      onBlur={() => {
        setFocused(false);
        to(1);
        onBlur?.();
      }}
    >
      <Animated.View
        style={[
          styles.base,
          { borderRadius: radius, transform: [{ scale: anim }] },
          focused && styles.focused,
          style,
        ]}
      >
        {typeof children === 'function' ? children(focused) : children}
      </Animated.View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  base: {
    borderWidth: 3,
    borderColor: 'transparent',
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  // No elevation: on a card with a transparent background (the side rail's items) Android draws the
  // shadow as a dark block behind the content. The white outline is the focus mark.
  focused: {
    borderColor: colors.textPrimary,
  },
});
