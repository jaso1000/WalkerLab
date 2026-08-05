import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PromptModal } from '../src/components/PromptModal';
import { useProfiles } from '../src/context/ProfilesContext';
import { alert } from '../src/lib/alert';
import { Profile } from '../src/lib/profiles';
import { exportProfile, importProfileInto } from '../src/lib/profileBackup';
import { useTabBarClearance } from '../src/lib/tabBarClearance';
import { colors } from '../src/theme/colors';

// Profile management screen ("Manage Profiles…" from ProfileSwitcher's
// sheet) - create/rename/delete profiles, plus passphrase-encrypted Backup
// (current profile -> shareable code) and Restore (code + passphrase ->
// always a brand-new profile, never overwriting an existing one).
// Passphrases are collected via a second `PromptModal` step rather than a
// single combined form, so the same modal component handles both flows.
export default function ProfilesScreen() {
  const tabBarClearance = useTabBarClearance();
  const { profiles, activeProfile, switchProfile, addProfile, renameProfile, deleteProfile } = useProfiles();

  const [renameTarget, setRenameTarget] = useState<Profile | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const [backupPromptOpen, setBackupPromptOpen] = useState(false);
  const [backingUp, setBackingUp] = useState(false);

  const [restoreCode, setRestoreCode] = useState('');
  const [restorePassphraseOpen, setRestorePassphraseOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // Deleting a profile removes everything stored under it - worth an
  // explicit confirm since (unlike most deletes in this app) there's no
  // keep-the-files-or-not middle ground.
  const confirmDelete = (profile: Profile) => {
    alert('Delete Profile', `Remove "${profile.name}" and everything configured under it? This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteProfile(profile.id) },
    ]);
  };

  // Encrypts the active profile's full config and hands the result to RN's
  // core `Share.share()` - see `backupCrypto.ts`/`profileBackup.ts` for the
  // encryption itself and why `Share` was chosen over a file-based library.
  const runBackup = async (passphrase: string) => {
    setBackupPromptOpen(false);
    if (!passphrase) return;
    setBackingUp(true);
    try {
      const code = await exportProfile(activeProfile.id, activeProfile.name, passphrase);
      await Share.share({ message: code, title: `WalkerLab Backup — ${activeProfile.name}` });
    } catch (e) {
      alert('Backup failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBackingUp(false);
    }
  };

  // Creates a placeholder profile first (so `addProfile`/`renameProfile`'s
  // functional-setState pattern applies here too - see the stale-closure
  // note in `ProfilesContext`), then decrypts the backup code into it and
  // renames it to the backup's saved name. If decryption fails (wrong
  // passphrase or corrupted code), switches back to the original profile and
  // deletes the half-created placeholder rather than leaving an empty
  // "Restoring…" profile behind.
  const runRestore = async (passphrase: string) => {
    setRestorePassphraseOpen(false);
    if (!passphrase || !restoreCode.trim()) return;
    const previousProfileId = activeProfile.id;
    setRestoring(true);
    try {
      const newId = await addProfile('Restoring…');
      try {
        const savedName = await importProfileInto(newId, restoreCode.trim(), passphrase);
        await renameProfile(newId, savedName);
        setRestoreCode('');
        alert('Restored', `"${savedName}" is ready and now active.`);
      } catch (e) {
        await switchProfile(previousProfileId);
        await deleteProfile(newId);
        throw e;
      }
    } catch (e) {
      alert('Restore failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Profiles</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.container, { paddingBottom: tabBarClearance }]}>
        <Text style={styles.sectionLabel}>PROFILES</Text>
        <View style={styles.card}>
          {profiles.map((profile, i) => {
            const active = profile.id === activeProfile.id;
            return (
              <View key={profile.id} style={[styles.profileRow, i > 0 && styles.profileRowDivider]}>
                <TouchableOpacity style={styles.profileRowMain} onPress={() => switchProfile(profile.id)}>
                  <Ionicons
                    name={active ? 'checkmark-circle' : 'ellipse-outline'}
                    size={20}
                    color={active ? colors.brand : colors.textMuted}
                  />
                  <Text style={[styles.profileName, active && styles.profileNameActive]} numberOfLines={1}>
                    {profile.name}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.rowIconButton} onPress={() => setRenameTarget(profile)}>
                  <Ionicons name="create-outline" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
                {profiles.length > 1 ? (
                  <TouchableOpacity style={styles.rowIconButton} onPress={() => confirmDelete(profile)}>
                    <Ionicons name="trash-outline" size={18} color={colors.danger} />
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })}
          <TouchableOpacity style={styles.addRow} onPress={() => setAddOpen(true)}>
            <Ionicons name="add-circle-outline" size={20} color={colors.brand} />
            <Text style={styles.addRowText}>Add New Profile</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel}>BACKUP</Text>
        <View style={styles.card}>
          <Text style={styles.cardHint}>
            Encrypt everything configured under "{activeProfile.name}" (servers, drawer names, enabled services,
            startup screen) into a code you can save or send anywhere.
          </Text>
          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={() => setBackupPromptOpen(true)}
            disabled={backingUp}
          >
            {backingUp ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <Text style={styles.primaryButtonText}>Backup "{activeProfile.name}"</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel}>RESTORE FROM BACKUP</Text>
        <View style={styles.card}>
          <Text style={styles.cardHint}>Paste a backup code below. Restoring always creates a new profile — it never overwrites an existing one.</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            value={restoreCode}
            onChangeText={setRestoreCode}
            placeholder="Paste backup code here"
            placeholderTextColor={colors.textMuted}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={[styles.button, styles.primaryButton, !restoreCode.trim() && styles.buttonDisabled]}
            onPress={() => setRestorePassphraseOpen(true)}
            disabled={restoring || !restoreCode.trim()}
          >
            {restoring ? <ActivityIndicator color={colors.background} /> : <Text style={styles.primaryButtonText}>Restore</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>

      <PromptModal
        visible={addOpen}
        title="New Profile"
        placeholder="e.g. Uncle Paul"
        confirmLabel="Create"
        onCancel={() => setAddOpen(false)}
        onConfirm={(name) => {
          setAddOpen(false);
          if (name.trim()) addProfile(name.trim());
        }}
      />
      <PromptModal
        visible={!!renameTarget}
        title="Rename Profile"
        placeholder="Profile name"
        initialValue={renameTarget?.name ?? ''}
        confirmLabel="Save"
        onCancel={() => setRenameTarget(null)}
        onConfirm={(name) => {
          if (renameTarget && name.trim()) renameProfile(renameTarget.id, name.trim());
          setRenameTarget(null);
        }}
      />
      <PromptModal
        visible={backupPromptOpen}
        title="Backup Passphrase"
        placeholder="Choose a passphrase"
        confirmLabel="Continue"
        secureTextEntry
        onCancel={() => setBackupPromptOpen(false)}
        onConfirm={runBackup}
      />
      <PromptModal
        visible={restorePassphraseOpen}
        title="Backup Passphrase"
        placeholder="Enter the backup's passphrase"
        confirmLabel="Restore"
        secureTextEntry
        onCancel={() => setRestorePassphraseOpen(false)}
        onConfirm={runRestore}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8 },
  iconButton: { padding: 8, width: 38 },
  topBarTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 17 },
  container: { padding: 16, gap: 14 },
  sectionLabel: {
    color: colors.brand,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: -2,
  },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, gap: 12 },
  cardHint: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  profileRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 12, marginTop: 4 },
  profileRowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  profileName: { color: colors.textSecondary, fontSize: 15, fontWeight: '600', flex: 1 },
  profileNameActive: { color: colors.textPrimary, fontWeight: '700' },
  rowIconButton: { padding: 6 },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 12,
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  addRowText: { color: colors.brand, fontSize: 15, fontWeight: '700' },
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
  inputMultiline: { minHeight: 90, textAlignVertical: 'top' },
  button: { borderRadius: 8, padding: 12, alignItems: 'center' },
  primaryButton: { backgroundColor: colors.brand },
  primaryButtonText: { color: colors.background, fontWeight: '700' },
  buttonDisabled: { opacity: 0.5 },
});
