// Setting up the TV, two ways:
// - Connect to the user's WalkerLab Docker server (server mode, src/lib/serverMode.ts): profiles and
//   services come from the server and API keys never reach the TV. Not shown once connected.
// - Restore a profile from the phone app's backup code and passphrase, pasted rather than typed (the
//   Google TV phone app's keyboard pastes into the focused field). Same flow as the phone's Profiles
//   screen (app/profiles.tsx): a new profile is created and filled from the backup, never
//   overwriting an existing one, and a failed restore removes the half-made profile again. In server
//   mode that profile is created on the server (keys go up to it, never down).
// Every field is pasted the same way.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useProfiles } from '../../src/context/ProfilesContext';
import { useServers } from '../../src/context/ServersContext';
import { importProfileInto } from '../../src/lib/profileBackup';
import { getServerSession } from '../../src/lib/serverMode';
import { colors } from '../../src/theme/colors';
import { FocusCard } from '../components/FocusCard';
import { TvServerConnectForm } from '../components/ServerConnect';
import { TV_LIST } from '../components/ui';

export default function TvSetup() {
  const { profiles, activeProfile, activeProfileId, addProfile, renameProfile, switchProfile, deleteProfile } = useProfiles();
  const { servers, refresh } = useServers();
  const [code, setCode] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoredId, setRestoredId] = useState<string | null>(null);
  const passRef = useRef<TextInput>(null);
  const configured = Object.keys(servers).length > 0;
  const server = getServerSession();

  // ServersProvider reloads when the active profile changes, which happens when the new profile is
  // created - before the backup has been written into it. Reload once more after the write, from a
  // render where `refresh` already belongs to the restored profile, then go Home.
  useEffect(() => {
    if (!restoredId || activeProfileId !== restoredId) return;
    refresh().then(() => router.replace('/'));
  }, [restoredId, activeProfileId, refresh]);

  const restore = async () => {
    if (!code.trim() || !passphrase) {
      setError('Paste the backup code and enter its passphrase.');
      return;
    }
    setBusy(true);
    setError(null);
    const previousId = activeProfileId;
    try {
      const newId = await addProfile('Restoring…');
      try {
        const name = await importProfileInto(newId, code.trim(), passphrase);
        await renameProfile(newId, name);
        setRestoredId(newId);
      } catch (e) {
        await switchProfile(previousId);
        await deleteProfile(newId);
        throw e;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Restore failed');
      setBusy(false);
    }
  };

  return (
    <ScrollView {...TV_LIST} style={styles.screen} contentContainerStyle={styles.content}>
      {server ? (
        <Text style={styles.hint}>Connected to your WalkerLab server at {server.url}. Profiles restored here are saved on the server.</Text>
      ) : (
        <>
          <Text style={styles.title}>Connect to your WalkerLab server</Text>
          <Text style={styles.hint}>
            Use the profiles and services set up on your WalkerLab Docker server; API keys stay on the server. Select a box and use the
            Google TV app's keyboard on your phone to type or paste, so nothing has to be typed with the remote.
          </Text>
          <TvServerConnectForm preferredFocus={!configured} />
          <View style={{ height: 40 }} />
        </>
      )}

      <Text style={styles.title}>{server ? 'Restore a profile' : 'Or restore a profile from your phone'}</Text>
      <Text style={styles.hint}>
        On your phone, open WalkerLab → Profiles → Backup, then paste the backup code here. On the TV, select a box and use the
        Google TV app's keyboard on your phone to paste, so nothing has to be typed with the remote.
      </Text>

      <Text style={styles.label}>BACKUP CODE</Text>
      <TextInput
        style={[styles.input, styles.codeInput]}
        value={code}
        onChangeText={setCode}
        placeholder="Paste backup code here"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        returnKeyType="next"
        onSubmitEditing={() => passRef.current?.focus()}
        hasTVPreferredFocus={!configured && !!server}
      />

      <Text style={styles.label}>PASSPHRASE</Text>
      <TextInput
        ref={passRef}
        style={styles.input}
        value={passphrase}
        onChangeText={setPassphrase}
        placeholder="The backup's passphrase"
        placeholderTextColor={colors.textMuted}
        secureTextEntry
        autoCapitalize="none"
        returnKeyType="done"
        onSubmitEditing={restore}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.buttons}>
        <FocusCard style={styles.primary} radius={10} scale={1.04} onPress={busy ? undefined : restore}>
          {busy ? <ActivityIndicator color={colors.background} /> : <Text style={styles.primaryText}>Restore</Text>}
        </FocusCard>
        {configured && (
          <FocusCard style={styles.secondary} radius={10} scale={1.04} onPress={() => router.back()} preferredFocus>
            <Text style={styles.secondaryText}>Back to Home</Text>
          </FocusCard>
        )}
      </View>

      {profiles.length > 1 && (
        <>
          <Text style={[styles.label, { marginTop: 28 }]}>{server ? 'PROFILES' : 'PROFILES ON THIS TV'}</Text>
          <View style={styles.profiles}>
            {profiles.map((p) => (
              <FocusCard
                key={p.id}
                style={[styles.chip, p.id === activeProfile.id && styles.chipActive]}
                radius={18}
                scale={1.04}
                onPress={async () => {
                  await switchProfile(p.id);
                  router.replace('/');
                }}
              >
                <Text style={[styles.chipText, p.id === activeProfile.id && { color: colors.background }]}>{p.name}</Text>
              </FocusCard>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 120, paddingVertical: 48 },
  title: { color: colors.textPrimary, fontSize: 28, fontWeight: '700' },
  hint: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, marginTop: 10, marginBottom: 26, maxWidth: 680 },
  label: { color: colors.textMuted, fontSize: 12, letterSpacing: 1.5, marginBottom: 8, marginTop: 6 },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    color: colors.textPrimary,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 14,
    maxWidth: 680,
  },
  codeInput: { height: 90, textAlignVertical: 'top' },
  error: { color: colors.danger, fontSize: 14, marginBottom: 12 },
  buttons: { flexDirection: 'row', gap: 16, marginTop: 6 },
  primary: { backgroundColor: colors.accent, paddingHorizontal: 28, paddingVertical: 11, minWidth: 140, alignItems: 'center' },
  primaryText: { color: colors.background, fontSize: 16, fontWeight: '700' },
  secondary: { backgroundColor: colors.surfaceAlt, paddingHorizontal: 24, paddingVertical: 11 },
  secondaryText: { color: colors.textPrimary, fontSize: 16, fontWeight: '500' },
  profiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  chip: { backgroundColor: colors.surfaceAlt, paddingHorizontal: 18, paddingVertical: 8 },
  chipActive: { backgroundColor: colors.accent },
  chipText: { color: colors.textPrimary, fontSize: 14, fontWeight: '500' },
});
