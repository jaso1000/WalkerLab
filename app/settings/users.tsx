import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/context/AuthContext';
import { alert } from '../../src/lib/alert';
import { useTabBarClearance } from '../../src/lib/tabBarClearance';
import { AppUser, createUser, deleteUser, listUsers } from '../../src/lib/users';
import { colors } from '../../src/theme/colors';

// Admin-only "Manage Users" screen (web only) - each account gets its own
// independent set of Server Profiles, same as if it were a separate
// install. Only reachable from Settings' ACCOUNT section, which is itself
// only shown to the admin - the role check below is defense-in-depth
// against someone directly navigating to /settings/users, not the primary
// gate (the server enforces this too, on every request, via requireAdmin).
export default function ManageUsersScreen() {
  const tabBarClearance = useTabBarClearance();
  const { role } = useAuth();

  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);

  const [addOpen, setAddOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await listUsers());
    } catch (e) {
      alert('Failed to load users', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const submitNewUser = async () => {
    if (!newUsername.trim() || newPassword.length < 8) {
      alert('Missing info', 'Enter a username and a password of at least 8 characters.');
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      alert("Passwords don't match", 'Re-enter the password to confirm it.');
      return;
    }
    setCreating(true);
    try {
      await createUser(newUsername.trim(), newPassword);
      setNewUsername('');
      setNewPassword('');
      setNewPasswordConfirm('');
      setAddOpen(false);
      await load();
    } catch (e) {
      alert('Failed to create user', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setCreating(false);
    }
  };

  const confirmDelete = (user: AppUser) => {
    alert('Delete User', `Remove "${user.username}" and everything under their profiles? This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteUser(user.id);
            await load();
          } catch (e) {
            alert('Failed to delete user', e instanceof Error ? e.message : 'Unknown error');
          }
        },
      },
    ]);
  };

  if (role !== 'admin') {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.topBarTitle}>Manage Users</Text>
          <View style={{ width: 38 }} />
        </View>
        <View style={styles.center}>
          <Text style={styles.emptyText}>Only the admin account can manage users.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Manage Users</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.container, { paddingBottom: tabBarClearance }]}>
        <Text style={styles.sectionLabel}>USERS</Text>
        <View style={styles.card}>
          {loading ? (
            <ActivityIndicator color={colors.brand} />
          ) : (
            users.map((user, i) => (
              <View key={user.id} style={[styles.userRow, i > 0 && styles.userRowDivider]}>
                <View style={styles.userRowMain}>
                  <Text style={styles.userName} numberOfLines={1}>
                    {user.username}
                  </Text>
                  {user.role === 'admin' ? (
                    <View style={styles.adminBadge}>
                      <Text style={styles.adminBadgeText}>ADMIN</Text>
                    </View>
                  ) : null}
                </View>
                {user.role !== 'admin' ? (
                  <TouchableOpacity style={styles.rowIconButton} onPress={() => confirmDelete(user)}>
                    <Ionicons name="trash-outline" size={18} color={colors.danger} />
                  </TouchableOpacity>
                ) : null}
              </View>
            ))
          )}

          {addOpen ? (
            <View style={styles.addForm}>
              <TextInput
                style={styles.input}
                value={newUsername}
                onChangeText={setNewUsername}
                placeholder="Username"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TextInput
                style={styles.input}
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder="Password (min. 8 characters)"
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                autoCapitalize="none"
              />
              <TextInput
                style={styles.input}
                value={newPasswordConfirm}
                onChangeText={setNewPasswordConfirm}
                placeholder="Confirm password"
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                autoCapitalize="none"
                onSubmitEditing={submitNewUser}
              />
              <View style={styles.addFormButtons}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => {
                    setAddOpen(false);
                    setNewUsername('');
                    setNewPassword('');
                    setNewPasswordConfirm('');
                  }}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.button, creating && styles.buttonDisabled]} onPress={submitNewUser} disabled={creating}>
                  {creating ? <ActivityIndicator color={colors.background} /> : <Text style={styles.buttonText}>Create User</Text>}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity style={styles.addRow} onPress={() => setAddOpen(true)}>
              <Ionicons name="add-circle-outline" size={20} color={colors.brand} />
              <Text style={styles.addRowText}>Add User</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.hint}>Each user gets their own independent set of Server Profiles - nothing is shared between accounts.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { color: colors.textSecondary, textAlign: 'center' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8 },
  iconButton: { padding: 8, width: 38 },
  topBarTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 17 },
  container: { padding: 16, gap: 14 },
  sectionLabel: { color: colors.brand, fontSize: 14, fontWeight: '700', letterSpacing: 0.5, marginBottom: -2 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, gap: 12 },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  userRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 12, marginTop: 4 },
  userRowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  userName: { color: colors.textPrimary, fontSize: 15, fontWeight: '600', flexShrink: 1, minWidth: 0 },
  adminBadge: { backgroundColor: colors.brand, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  adminBadgeText: { color: colors.background, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
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
  addForm: {
    gap: 10,
    paddingTop: 14,
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
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
  addFormButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, alignItems: 'center' },
  cancelButton: { padding: 8 },
  cancelButtonText: { color: colors.textSecondary, fontSize: 14, fontWeight: '700' },
  button: { backgroundColor: colors.brand, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.background, fontWeight: '700' },
  hint: { color: colors.textSecondary, fontSize: 12, textAlign: 'center' },
});
