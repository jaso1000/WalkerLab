// Thin wrapper around RN's own <Switch> that actually shows the right thumb
// color on web. Native's Switch uses one `thumbColor` prop for both the
// on/off thumb - react-native-web instead only honors `thumbColor` while
// the switch is OFF, and uses a completely different, RN-undocumented prop
// (`activeThumbColor`) for the ON state, silently falling back to its own
// hardcoded teal default (#009688, see react-native-web's Switch source)
// when that's never supplied. Every per-service/tinted toggle in this app
// was rendering that same fallback teal for every "on" switch on web
// regardless of its intended tint - confirmed via a real device screenshot
// showing every SERVICES row's switch identically teal, while the native
// APK (whose Switch has no such split) showed each one correctly
// color-coded. `activeThumbColor` isn't in native Switch's own prop types
// at all, so it's only ever added here, web-only - passing it natively
// would be a silent no-op anyway, but there's no reason to.
import { Platform, Switch, SwitchProps } from 'react-native';

export function ThemedSwitch({
  value,
  onValueChange,
  trackColor,
  activeColor,
  inactiveColor,
  style,
  disabled,
}: {
  value: boolean;
  onValueChange: (value: boolean) => void;
  trackColor: { false: string; true: string };
  activeColor: string;
  inactiveColor: string;
  style?: SwitchProps['style'];
  disabled?: boolean;
}) {
  const webOnlyProps = Platform.OS === 'web' ? ({ activeThumbColor: activeColor } as Record<string, string>) : {};
  return (
    <Switch
      style={style}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={trackColor}
      thumbColor={value ? activeColor : inactiveColor}
      {...webOnlyProps}
    />
  );
}
