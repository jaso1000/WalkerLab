// Gates the whole app behind a login on web, and in the native app's
// optional server mode (src/lib/serverMode.ts). Standalone native (the
// default) is a passthrough - no network call, no behavior change. On web, checks
// the backend's session state once on mount and renders the first-run setup
// wizard or login screen in place of `children` until authenticated. Kept
// outside `ProfilesProvider` in app/_layout.tsx (see the file's own
// provider-order comment) since nothing profile-scoped should even try to
// load before the instance is unlocked.
//
// Native: waits for the stored server-mode state to load, then either
// passes straight through (standalone) or checks the server session and
// shows ServerGateScreen (login / unreachable) until it's valid. Switching
// between modes, or logging back in, remounts everything inside the gate
// (`key={epoch}`), so every profile-scoped provider reloads from the right
// source rather than keeping the other mode's data.
import { createContext, Fragment, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { AlertHost } from '../components/AlertHost';
import { checkServerSession, isNativeServerMode, loadServerSession, logoutServer, onServerModeChange } from '../lib/serverMode';
import { ServerGateScreen } from '../screens/ServerGateScreen';
import { LoginScreen } from '../screens/web/LoginScreen';
import { SetupWizardScreen } from '../screens/web/SetupWizardScreen';
import { colors } from '../theme/colors';

type SessionState = 'loading' | 'needs-setup' | 'needs-login' | 'authenticated';

interface AuthContextValue {
  // undefined on standalone native (see the default context value below) -
  // always a real string once `AuthGate` has actually rendered `children` on
  // web or in native server mode, since that only happens once authenticated.
  username?: string;
  role?: 'admin' | 'user';
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({ logout: async () => {} });

// Standalone native screens never render inside a real
// `AuthContext.Provider` (there's nothing to gate), so this default no-op is
// what they'd get if they ever called `useAuth()` - harmless.
export function useAuth() {
  return useContext(AuthContext);
}

export function AuthGate({ children }: { children: ReactNode }) {
  if (Platform.OS !== 'web') {
    // The app's own AlertHost lives inside the gate, so the gate screen mounts one for its alerts.
    return (
      <NativeAuthGate
        renderGate={(props) => (
          <>
            <ServerGateScreen {...props} />
            <AlertHost />
          </>
        )}
      >
        {children}
      </NativeAuthGate>
    );
  }
  return <WebAuthGate>{children}</WebAuthGate>;
}

type NativeState = 'loading' | 'standalone' | 'authenticated' | 'needs-login' | 'unreachable';

export interface ServerGateProps {
  mode: 'login' | 'unreachable';
  message?: string;
  onRetry: () => Promise<void>;
}

// The native gate itself, shared by the phone (AuthGate above) and the TV app
// (tv/app/_layout.tsx), which only differ in the login/unreachable screen
// they draw (`renderGate`).
export function NativeAuthGate({ children, renderGate }: { children: ReactNode; renderGate: (props: ServerGateProps) => ReactNode }) {
  const [state, setState] = useState<NativeState>('loading');
  const [account, setAccount] = useState<{ username: string; role: 'admin' | 'user' } | null>(null);
  const [message, setMessage] = useState<string>();
  const [epoch, setEpoch] = useState(0);

  const check = useCallback(async () => {
    await loadServerSession();
    if (!isNativeServerMode()) {
      setAccount(null);
      setState('standalone');
      return;
    }
    const result = await checkServerSession();
    if (result.state === 'authenticated') {
      setAccount({ username: result.username, role: result.role });
      setState('authenticated');
    } else if (result.state === 'needs-login') {
      setAccount(null);
      setState('needs-login');
    } else {
      setMessage(result.message);
      setState('unreachable');
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  useEffect(
    () =>
      onServerModeChange((event) => {
        setEpoch((e) => e + 1);
        if (event === 'logged-out') {
          setAccount(null);
          setState('needs-login');
          return;
        }
        setState('loading');
        check();
      }),
    [check]
  );

  const value = useMemo(() => ({ username: account?.username, role: account?.role, logout: logoutServer }), [account]);

  if (state === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  if (state === 'needs-login' || state === 'unreachable') {
    return <>{renderGate({ mode: state === 'needs-login' ? 'login' : 'unreachable', message, onRetry: check })}</>;
  }
  if (state === 'standalone') return <Fragment key={epoch}>{children}</Fragment>;
  return (
    <AuthContext.Provider value={value}>
      <Fragment key={epoch}>{children}</Fragment>
    </AuthContext.Provider>
  );
}

function WebAuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>('loading');
  const [account, setAccount] = useState<{ username: string; role: 'admin' | 'user' } | null>(null);

  const checkSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session', { credentials: 'include' });
      const body = await res.json();
      setState(body.state);
      setAccount(body.state === 'authenticated' ? { username: body.username, role: body.role } : null);
    } catch {
      // Backend unreachable (e.g. a plain `expo start --web` dev session
      // with no Node backend running alongside it) - fail toward "needs
      // login" rather than an infinite spinner.
      setState('needs-login');
      setAccount(null);
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setState('needs-login');
    setAccount(null);
  }, []);

  const value = useMemo(
    () => ({ username: account?.username, role: account?.role, logout }),
    [account, logout]
  );

  if (state === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  if (state === 'needs-setup') return <SetupWizardScreen onComplete={checkSession} />;
  if (state === 'needs-login') return <LoginScreen onComplete={checkSession} />;

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
});
