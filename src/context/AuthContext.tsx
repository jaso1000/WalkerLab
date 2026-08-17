// Gates the whole app behind a login on web only - on native this is a pure
// passthrough (no network call, no behavior change at all), since native
// builds never had a backend/auth concept and never will. On web, checks
// the backend's session state once on mount and renders the first-run setup
// wizard or login screen in place of `children` until authenticated. Kept
// outside `ProfilesProvider` in app/_layout.tsx (see the file's own
// provider-order comment) since nothing profile-scoped should even try to
// load before the instance is unlocked.
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { LoginScreen } from '../screens/web/LoginScreen';
import { SetupWizardScreen } from '../screens/web/SetupWizardScreen';
import { colors } from '../theme/colors';

type SessionState = 'loading' | 'needs-setup' | 'needs-login' | 'authenticated';

interface AuthContextValue {
  // undefined on native (see the default context value below) - always a
  // real string once `AuthGate` has actually rendered `children` on web,
  // since that only happens in the 'authenticated' state.
  username?: string;
  role?: 'admin' | 'user';
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({ logout: async () => {} });

// Native screens never render inside a real `AuthContext.Provider` (there's
// nothing to gate), so this default no-op is what they'd get if they ever
// called `useAuth()` - harmless, but nothing on native should need to.
export function useAuth() {
  return useContext(AuthContext);
}

export function AuthGate({ children }: { children: ReactNode }) {
  if (Platform.OS !== 'web') return <>{children}</>;
  return <WebAuthGate>{children}</WebAuthGate>;
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
