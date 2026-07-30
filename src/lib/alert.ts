// App-wide themed alert system. React Native's built-in `Alert.alert()` uses
// the OS's native alert UI, which doesn't match this app's dark theme, so
// this module + `AlertHost.tsx` implement a custom in-app alert that any
// screen can trigger without needing its own local modal state.

export interface AppAlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

export interface AppAlertState {
  title: string;
  message?: string;
  buttons: AppAlertButton[];
}

type Listener = (state: AppAlertState | null) => void;

// Single global listener slot - `AlertHost` (mounted once near the app root)
// registers itself here so any call to `alert()` from anywhere in the app
// can reach it, without prop-drilling or context.
let listener: Listener | null = null;

// Called by `AlertHost` on mount/unmount to become the one active renderer
// for alert state. Passing `null` clears it (host unmounted).
export function registerAlertListener(fn: Listener | null) {
  listener = fn;
}

// Show a themed alert. Defaults to a single "OK" button when none are given,
// matching `Alert.alert()`'s own default behavior.
export function alert(title: string, message?: string, buttons?: AppAlertButton[]) {
  const finalButtons = buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }];
  listener?.({ title, message, buttons: finalButtons });
}
