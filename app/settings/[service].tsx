import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getCertificateInfo } from '../../modules/tls-trust';
import { lastfmApi } from '../../src/api/lastfm';
import { lidarrApi } from '../../src/api/lidarr';
import { nzbgetApi } from '../../src/api/nzbget';
import { overseerrApi } from '../../src/api/overseerr';
import { qbittorrentApi } from '../../src/api/qbittorrent';
import { radarrApi } from '../../src/api/radarr';
import { transmissionApi } from '../../src/api/transmission';
import { sabnzbdApi } from '../../src/api/sabnzbd';
import { sonarrApi } from '../../src/api/sonarr';
import { omdbApi } from '../../src/api/omdb';
import { portainerApi } from '../../src/api/portainer';
import { tautulliApi } from '../../src/api/tautulli';
import { tmdbApi, TmdbWatchRegion } from '../../src/api/tmdb';
import { ServiceConfig, ServiceName } from '../../src/api/types';
import { ActionSheet } from '../../src/components/ActionSheet';
import { SwitchRow } from '../../src/components/SelectRow';
import { useProfiles } from '../../src/context/ProfilesContext';
import { useSectionNames } from '../../src/context/SectionNamesContext';
import { useServers } from '../../src/context/ServersContext';
import { alert } from '../../src/lib/alert';
import { FALLBACK_WATCH_REGION, getDefaultRegion, setDefaultRegion } from '../../src/lib/preferences';
import { DEFAULT_SECTION_NAMES } from '../../src/lib/sectionNames';
import { SERVICE_META } from '../../src/lib/serviceMeta';
import { DEFAULT_STARTUP_SCREEN, getStartupScreen, setStartupScreen, StartupSectionId } from '../../src/lib/startupScreen';
import { useTabBarClearance } from '../../src/lib/tabBarClearance';
import { colors } from '../../src/theme/colors';

// Per-service config page: connection fields, an optional drawer-rename +
// startup-screen control (for services that own a nav section), and a Test
// Connection / Save pair. One dynamic route handles every service via
// `SERVICE_META`, rather than a separate screen per service.

// Dispatch table so "Test Connection" can call the right service's own
// `testConnection` without a big switch statement.
const TEST_CONNECTION: Record<ServiceName, (config: ServiceConfig) => Promise<unknown>> = {
  sonarr: sonarrApi.testConnection,
  radarr: radarrApi.testConnection,
  lidarr: lidarrApi.testConnection,
  sabnzbd: sabnzbdApi.testConnection,
  nzbget: nzbgetApi.testConnection,
  tmdb: tmdbApi.testConnection,
  omdb: omdbApi.testConnection,
  lastfm: lastfmApi.testConnection,
  overseerr: overseerrApi.testConnection,
  qbittorrent: qbittorrentApi.testConnection,
  transmission: transmissionApi.testConnection,
  tautulli: tautulliApi.testConnection,
  portainer: portainerApi.testConnection,
};

// Trims whitespace and strips a trailing slash from the URL before saving/
// testing, and normalizes empty optional fields to `undefined` rather than
// storing empty strings. Carries `profileId` straight through untouched -
// on web, the low-level fetch helpers (arrFetch/qbittorrent/portainer) need
// it to know which profile's stored config to proxy a request through (see
// arrFetch.ts); harmless and unused on native.
function normalize(config: ServiceConfig): ServiceConfig {
  return {
    baseUrl: config.baseUrl.trim().replace(/\/+$/, ''),
    apiKey: config.apiKey.trim(),
    username: config.username?.trim() || undefined,
    password: config.password || undefined,
    trustedCertFingerprint: config.trustedCertFingerprint || undefined,
    profileId: config.profileId,
  };
}

export default function ServiceSettingsScreen() {
  const tabBarClearance = useTabBarClearance();
  const { service } = useLocalSearchParams<{ service: string }>();
  const meta = SERVICE_META.find((s) => s.name === service);
  const { activeProfileId } = useProfiles();
  const { servers, updateServer, refresh, loadedProfileId } = useServers();
  const { names, setName, resetName } = useSectionNames();

  const existing = meta ? servers[meta.name] : undefined;
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState(existing?.apiKey ?? '');
  const [username, setUsername] = useState(existing?.username ?? '');
  const [password, setPassword] = useState(existing?.password ?? '');
  const [trustedCertFingerprint, setTrustedCertFingerprint] = useState(existing?.trustedCertFingerprint ?? '');
  // `ProfilesContext` can update `activeProfileId` in a render before
  // `ServersContext`'s own effect (which depends on that same value) has
  // re-run its `refresh()` for it - during that window `servers`/`loading`
  // still reflect the *previous* profile, making "loading is false" alone
  // an unsafe signal that this screen's data is fresh (confirmed via
  // console tracing: a render existed with the new activeProfileId, loading
  // already false, but `existing` still carrying the old profile's data).
  // `loadedProfileId` (see ServersContext.tsx) is the fix - it only updates
  // once a load has actually completed *for* a specific profile, so gating
  // on `loadedProfileId === activeProfileId` (rather than just `!loading`)
  // guarantees `existing` really belongs to the profile we're about to sync
  // for. `syncedProfileIdRef` then makes sure that sync happens exactly
  // once per real profile change, not on every later `existing` update
  // (e.g. this screen's own post-Save `refresh()` call, which doesn't
  // change `activeProfileId`) - so it never clobbers whatever the user's
  // since typed.
  const syncedProfileIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (loadedProfileId !== activeProfileId || syncedProfileIdRef.current === activeProfileId) return;
    syncedProfileIdRef.current = activeProfileId;
    setBaseUrl(existing?.baseUrl ?? '');
    setApiKey(existing?.apiKey ?? '');
    setUsername(existing?.username ?? '');
    setPassword(existing?.password ?? '');
    setTrustedCertFingerprint(existing?.trustedCertFingerprint ?? '');
  }, [loadedProfileId, activeProfileId, existing]);
  const [testing, setTesting] = useState(false);
  const [nameValue, setNameValue] = useState(meta?.sectionId ? names[meta.sectionId] : '');
  const [startupId, setStartupId] = useState<StartupSectionId>(DEFAULT_STARTUP_SCREEN);

  // TMDB-only: Discover's "Default Region" (Streaming Service row + the
  // filter panel's watch-provider search both fall back to this whenever
  // the user hasn't picked a one-off region for that particular screen).
  const [defaultRegionCode, setDefaultRegionCode] = useState(FALLBACK_WATCH_REGION);
  const [regionOptions, setRegionOptions] = useState<TmdbWatchRegion[]>([]);
  const [regionSheetOpen, setRegionSheetOpen] = useState(false);
  useEffect(() => {
    getDefaultRegion().then(setDefaultRegionCode).catch((e) => console.error('Failed to load default region', e));
  }, []);
  const regionName = regionOptions.find((r) => r.iso_3166_1 === defaultRegionCode)?.english_name ?? defaultRegionCode;
  // The region list comes from TMDB itself, so it needs a real saved
  // connection - lazily fetched the first time the picker actually opens,
  // not on every visit to this screen.
  const openRegionPicker = () => {
    if (!existing?.apiKey && !existing?.hasApiKey) {
      alert('Save your TMDB connection first', 'The region list is looked up from TMDB itself.');
      return;
    }
    if (regionOptions.length === 0) tmdbApi.watchProviderRegions(existing!).then(setRegionOptions).catch(() => {});
    setRegionSheetOpen(true);
  };

  const scrollRef = useRef<ScrollView>(null);
  // Each card is a direct child of the ScrollView's content, so its own
  // onLayout `y` is already a scroll-content-relative offset. Each field's
  // onLayout `y` is relative to its card. Summing the two gives an absolute
  // scroll offset without ever needing ref.measureLayout, which crashes
  // ("must be called with a ref to a native component") on some TextInput
  // refs under the New Architecture.
  const nameCardY = useRef(0);
  const connectionCardY = useRef(0);
  const fieldY = useRef<Record<string, number>>({});

  // Scrolls a focused field into view above the keyboard - manual since
  // `KeyboardAvoidingView` alone doesn't guarantee a specific field stays
  // visible once the keyboard shrinks the viewport.
  const scrollFieldIntoView = (cardY: React.RefObject<number>, key: string) => {
    // Wait for the keyboard-driven resize to settle first, otherwise this
    // scrolls to where the field was before the view shrank.
    setTimeout(() => {
      const y = cardY.current + (fieldY.current[key] ?? 0);
      scrollRef.current?.scrollTo({ y: Math.max(y - 24, 0), animated: true });
    }, 250);
  };

  useFocusEffect(
    useCallback(() => {
      getStartupScreen(activeProfileId).then(setStartupId).catch((e) => console.error('Failed to load startup screen', e));
    }, [activeProfileId])
  );

  useEffect(() => {
    if (meta?.sectionId) setNameValue(names[meta.sectionId]);
  }, [names, meta?.sectionId]);

  if (!meta) return null;

  const isCustomName = meta.sectionId ? names[meta.sectionId] !== DEFAULT_SECTION_NAMES[meta.sectionId] : false;
  const isStartup = meta.sectionId === startupId;
  // A service with no URL requirement (TMDB/OMDb) or an optional API key
  // (qBittorrent, when using username/password instead) has a correspondingly
  // relaxed validity check. On web, an already-configured secret shows as a
  // blank field (the real value lives server-side, never sent to the
  // browser - see storage.ts) - `existing?.hasApiKey` lets Save stay enabled
  // in that case instead of demanding the user retype a key they can't see.
  const canSubmit =
    (!meta.requiresUrl || baseUrl.trim().length > 0) &&
    (meta.apiKeyOptional || apiKey.trim().length > 0 || existing?.hasApiKey === true);

  const saveConnection = async () => {
    await updateServer(meta.name, normalize({ baseUrl, apiKey, username, password, trustedCertFingerprint, profileId: activeProfileId }));
    // Re-fetches from storage rather than trusting the just-saved local
    // object - on web, a blank apiKey/password field means "keep whatever's
    // already stored" (see storage.ts), so `existing.hasApiKey`/`hasPassword`
    // need the backend's real post-save state to show the right placeholder,
    // not the blank values that were actually submitted.
    await refresh();
    alert('Saved', `${meta.label} settings saved.`);
  };

  // Fetches the server's actual certificate (Android only - see
  // `modules/tls-trust`) and, if it's reachable at all, shows an explicit
  // confirm dialog with the real subject/issuer/fingerprint before trusting
  // it - the "prompt before bypassing any TLS check" this needs, showing
  // what's actually being trusted rather than a blind checkbox. Returns
  // whether a cert was found and the dialog shown, so the caller can skip
  // its own generic failure alert in that case (this dialog is now handling
  // the user-facing response instead).
  const tryOfferCertTrust = async (): Promise<boolean> => {
    let host: string;
    let port: number;
    try {
      const parsed = new URL(baseUrl.trim());
      host = parsed.hostname;
      port = Number(parsed.port) || 443;
    } catch {
      return false;
    }

    const certInfo = await getCertificateInfo(host, port);
    if (!certInfo) return false;

    alert(
      'Certificate Not Trusted',
      `${meta.label} is reachable, but its certificate isn't automatically trusted (most likely self-signed):\n\n` +
        `Subject: ${certInfo.subject}\nIssuer: ${certInfo.issuer}\nValid: ${certInfo.notBefore} – ${certInfo.notAfter}\nFingerprint: ${certInfo.sha256}\n\n` +
        `Only trust this if you recognize this server.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Trust This Certificate',
          onPress: () => {
            setTrustedCertFingerprint(certInfo.sha256);
            runTestConnection(certInfo.sha256);
          },
        },
      ]
    );
    return true;
  };

  // Tests with the currently-typed field values, not the already-saved
  // config - lets the user verify before committing to Save. `fingerprint`
  // is threaded through explicitly (rather than read from state) so the
  // retry `tryOfferCertTrust` triggers after the user accepts a certificate
  // can use the just-accepted value immediately, without waiting on a
  // state update to land first.
  const runTestConnection = async (fingerprint: string) => {
    try {
      await TEST_CONNECTION[meta.name](
        normalize({ baseUrl, apiKey, username, password, trustedCertFingerprint: fingerprint, profileId: activeProfileId })
      );
      alert('Success', `Connected to ${meta.label}.`);
    } catch (e) {
      if (meta.supportsCertTrust && !fingerprint && baseUrl.trim().toLowerCase().startsWith('https://')) {
        if (await tryOfferCertTrust()) return;
      }
      alert('Connection failed', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      await runTestConnection(trustedCertFingerprint);
    } finally {
      setTesting(false);
    }
  };

  // Turning this service's startup toggle off falls back to the app-wide
  // default rather than leaving no startup screen selected at all.
  const toggleStartup = (value: boolean) => {
    if (!meta.sectionId) return;
    const next = value ? meta.sectionId : DEFAULT_STARTUP_SCREEN;
    setStartupId(next);
    setStartupScreen(activeProfileId, next);
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.topBarTitleRow}>
          <Ionicons name={meta.icon} size={18} color={meta.tint} />
          <Text style={styles.topBarTitle}>{meta.label}</Text>
        </View>
        <View style={{ width: 38 }} />
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.container, { paddingBottom: tabBarClearance }]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.description}>{meta.description}</Text>

          {meta.sectionId ? (
            <View style={styles.card} onLayout={(e) => (nameCardY.current = e.nativeEvent.layout.y)}>
              <Text style={styles.sectionLabel}>MENU NAME</Text>
              <View style={styles.nameRowHeader}>
                <Text style={styles.fieldLabel}>Rename in drawer &amp; header</Text>
                {isCustomName ? (
                  <TouchableOpacity onPress={() => resetName(meta.sectionId!)}>
                    <Text style={[styles.resetLink, { color: meta.tint }]}>Reset</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              <TextInput
                style={styles.input}
                value={nameValue}
                onChangeText={setNameValue}
                onLayout={(e) => (fieldY.current.rename = e.nativeEvent.layout.y)}
                onFocus={() => scrollFieldIntoView(nameCardY, 'rename')}
                onBlur={() => setName(meta.sectionId!, nameValue)}
                placeholder={DEFAULT_SECTION_NAMES[meta.sectionId]}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="words"
              />

              <SwitchRow label="Open this on app launch" value={isStartup} onChange={toggleStartup} tint={meta.tint} />
            </View>
          ) : null}

          {meta.urlExamples?.length ? (
            <View style={styles.card}>
              <Text style={styles.sectionLabel}>COMMON URLS &amp; PORTS</Text>
              {/* The template goes first, tinted in the service's own color so
                  it reads as the pattern rather than a fourth literal example,
                  then the worked examples follow underneath it. */}
              {meta.urlTemplate ? (
                <>
                  <Text style={[styles.templateText, { color: meta.tint }]}>{meta.urlTemplate}</Text>
                  <Text style={styles.templateHint}>For example:</Text>
                </>
              ) : null}
              {meta.urlExamples.map((example) => (
                <Text key={example} style={styles.exampleText}>
                  {example}
                </Text>
              ))}
            </View>
          ) : null}

          <View style={styles.card} onLayout={(e) => (connectionCardY.current = e.nativeEvent.layout.y)}>
            <Text style={styles.sectionLabel}>CONNECTION SETTINGS</Text>

            {meta.requiresUrl ? (
              <>
                <Text style={styles.fieldLabel}>Server URL</Text>
                <TextInput
                  style={styles.input}
                  value={baseUrl}
                  onChangeText={setBaseUrl}
                  onLayout={(e) => (fieldY.current.baseUrl = e.nativeEvent.layout.y)}
                  onFocus={() => scrollFieldIntoView(connectionCardY, 'baseUrl')}
                  placeholder={meta.placeholder}
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  keyboardType="url"
                />
              </>
            ) : null}

            {meta.usesCredentials ? (
              <>
                <Text style={styles.fieldLabel}>Username</Text>
                <TextInput
                  style={styles.input}
                  value={username}
                  onChangeText={setUsername}
                  onLayout={(e) => (fieldY.current.username = e.nativeEvent.layout.y)}
                  onFocus={() => scrollFieldIntoView(connectionCardY, 'username')}
                  placeholder="Username"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                />

                <Text style={styles.fieldLabel}>Password</Text>
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  onLayout={(e) => (fieldY.current.password = e.nativeEvent.layout.y)}
                  onFocus={() => scrollFieldIntoView(connectionCardY, 'password')}
                  placeholder={existing?.hasPassword ? 'Currently set — leave blank to keep' : 'Password'}
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  secureTextEntry
                />
              </>
            ) : null}

            {meta.signupUrl ? (
              <TouchableOpacity style={styles.signupLink} onPress={() => Linking.openURL(meta.signupUrl!)}>
                <Text style={[styles.signupLinkText, { color: meta.tint }]}>Don&apos;t have a key? Get a free one</Text>
                <Ionicons name="open-outline" size={14} color={meta.tint} />
              </TouchableOpacity>
            ) : null}

            <Text style={styles.fieldLabel}>{meta.usesCredentials ? 'API Key (optional)' : 'API Key'}</Text>
            {meta.usesCredentials ? (
              <Text style={styles.fieldHint}>
                Only needed if {meta.label} sits behind a reverse proxy that authenticates with a bearer token instead
                — leave blank to use the username and password above.
              </Text>
            ) : null}
            <TextInput
              style={styles.input}
              value={apiKey}
              onChangeText={setApiKey}
              onLayout={(e) => (fieldY.current.apiKey = e.nativeEvent.layout.y)}
              onFocus={() => scrollFieldIntoView(connectionCardY, 'apiKey')}
              placeholder={existing?.hasApiKey ? 'Currently set — leave blank to keep' : 'API key'}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              secureTextEntry
            />

            {meta.supportsCertTrust && trustedCertFingerprint ? (
              <View style={styles.certTrustRow}>
                <View style={styles.certTrustTextGroup}>
                  <Text style={styles.certTrustLabel}>Trusting this server's certificate</Text>
                  <Text style={styles.certTrustFingerprint} numberOfLines={1}>
                    {trustedCertFingerprint}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setTrustedCertFingerprint('')}>
                  <Text style={[styles.resetLink, { color: colors.danger }]}>Forget</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.button, styles.testButton, !canSubmit && styles.buttonDisabled]}
                onPress={testConnection}
                disabled={testing || !canSubmit}
              >
                <Text style={styles.testButtonText}>{testing ? 'Testing…' : 'Test Connection'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, { backgroundColor: meta.tint }, !canSubmit && styles.buttonDisabled]}
                onPress={saveConnection}
                disabled={!canSubmit}
              >
                <Text
                  style={[
                    styles.saveButtonText,
                    { color: meta.tint === colors.accent || meta.tint === colors.sabnzbd ? '#1A1300' : colors.textPrimary },
                  ]}
                >
                  Save
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {meta.name === 'tmdb' ? (
            <View style={styles.card}>
              <Text style={styles.sectionLabel}>DISCOVER PREFERENCES</Text>
              <Text style={styles.fieldLabel}>Default Region</Text>
              <Text style={styles.fieldHint}>
                Used for Discover's Streaming Service row and the filter panel's watch-provider search, whenever a
                screen hasn&apos;t had a one-off region picked for it.
              </Text>
              <TouchableOpacity style={styles.regionField} onPress={openRegionPicker}>
                <Text style={styles.regionFieldText}>{regionName}</Text>
                <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <ActionSheet
        visible={regionSheetOpen}
        title="Default Region"
        onClose={() => setRegionSheetOpen(false)}
        options={[...regionOptions]
          .sort((a, b) => a.english_name.localeCompare(b.english_name))
          .map((r) => ({
            label: r.english_name,
            onPress: () => {
              setDefaultRegionCode(r.iso_3166_1);
              setDefaultRegion(r.iso_3166_1);
            },
          }))}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8 },
  iconButton: { padding: 8, width: 38 },
  topBarTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  topBarTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 17 },
  keyboardAvoider: { flex: 1 },
  container: { padding: 16, paddingBottom: 140, gap: 14 },
  description: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, gap: 4 },
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  nameRowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  resetLink: { fontSize: 12, fontWeight: '700' },
  fieldLabel: { fontSize: 13, color: colors.textSecondary, marginTop: 8, marginBottom: 4 },
  fieldHint: { fontSize: 12, color: colors.textMuted, marginBottom: 6, lineHeight: 16 },
  // Slightly larger than the examples below it and tinted inline per service -
  // this is the line users are meant to read as "fill in your own values".
  templateText: { fontSize: 14, fontWeight: '600', marginBottom: 8, fontFamily: 'monospace' },
  templateHint: { fontSize: 12, color: colors.textMuted, marginBottom: 6 },
  exampleText: { color: colors.textPrimary, fontSize: 13, marginBottom: 6, fontFamily: 'monospace' },
  signupLink: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  signupLinkText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 10,
    backgroundColor: colors.surfaceAlt,
    color: colors.textPrimary,
    // 16px avoids iOS Safari's auto-zoom-on-focus for small inputs - see movies.tsx.
    fontSize: 16,
  },
  certTrustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
    padding: 10,
    borderRadius: 8,
    backgroundColor: colors.surfaceAlt,
  },
  certTrustTextGroup: { flex: 1, gap: 2 },
  certTrustLabel: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  certTrustFingerprint: { color: colors.textMuted, fontSize: 11, fontFamily: 'monospace' },
  buttonRow: { flexDirection: 'row', gap: 12, marginTop: 14 },
  button: { flex: 1, borderRadius: 8, padding: 12, alignItems: 'center' },
  testButton: { backgroundColor: colors.surfaceAlt },
  testButtonText: { color: colors.textPrimary, fontWeight: '600' },
  saveButtonText: { fontWeight: '700' },
  buttonDisabled: { opacity: 0.5 },
  regionField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceAlt,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginTop: 4,
  },
  regionFieldText: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
});
