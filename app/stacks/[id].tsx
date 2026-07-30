// Stack detail page (Portainer) - name/type, Start/Stop for the whole
// stack, and the list of member containers (matched by the
// `com.docker.compose.project` label, same as the main Containers screen),
// each tappable through to its own container detail page. Structurally
// mirrors `app/containers/[id].tsx`.
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  containerName,
  containerStackName,
  containerStatusLabel,
  PortainerContainer,
  portainerApi,
  PortainerStack,
  stackTypeLabel,
  stackWebUrl,
} from '../../src/api/portainer';
import { useServers } from '../../src/context/ServersContext';
import { alert } from '../../src/lib/alert';
import { titleCase } from '../../src/lib/format';
import { colors } from '../../src/theme/colors';

export default function StackDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const stackId = Number(id);
  const { servers } = useServers();
  const config = servers.portainer;

  const [stack, setStack] = useState<PortainerStack | null>(null);
  const [members, setMembers] = useState<PortainerContainer[]>([]);
  const [webUrl, setWebUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!config || !stackId) return;
    setLoading(true);
    try {
      const [stacks, containers, envId] = await Promise.all([
        portainerApi.listStacks(config),
        portainerApi.listContainers(config),
        portainerApi.getPrimaryEndpointId(config),
      ]);
      const match = stacks.find((s) => s.Id === stackId) ?? null;
      setStack(match);
      setMembers(containers.filter((c) => containerStackName(c)?.toLowerCase() === match?.Name.toLowerCase()));
      setWebUrl(match ? stackWebUrl(config, envId, match.Id) : null);
    } catch (e) {
      alert('Failed to load stack', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [config, stackId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const toggleStack = async () => {
    if (!config || !stack) return;
    setBusy(true);
    try {
      if (stack.Status === 1) await portainerApi.stopStack(config, stack);
      else await portainerApi.startStack(config, stack);
      await load();
    } catch (e) {
      alert('Failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  if (!config) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Containers isn&apos;t connected.</Text>
      </View>
    );
  }

  if (loading && !stack) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.portainer} />
      </View>
    );
  }

  if (!stack) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Stack not found.</Text>
      </View>
    );
  }

  const active = stack.Status === 1;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle} numberOfLines={1}>
          {stack.Name}
        </Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>STACK</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Type</Text>
            <Text style={styles.rowValue}>{stackTypeLabel(stack.Type)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Status</Text>
            <Text style={styles.rowValue}>{active ? 'Active' : 'Inactive'}</Text>
          </View>
          <TouchableOpacity
            style={[styles.toggleButton, { backgroundColor: active ? colors.dangerMuted : colors.portainerMuted }]}
            disabled={busy}
            onPress={toggleStack}
          >
            <Text style={[styles.toggleButtonText, { color: active ? colors.danger : colors.portainer }]}>
              {active ? 'Stop Stack' : 'Start Stack'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>CONTAINERS ({members.length})</Text>
          {members.length === 0 ? (
            <Text style={styles.emptyText}>No containers found for this stack.</Text>
          ) : (
            members.map((item, i) => (
              <TouchableOpacity
                key={item.Id}
                style={[styles.memberRow, i < members.length - 1 && styles.memberRowDivider]}
                onPress={() => router.push(`/containers/${item.Id}`)}
              >
                <Text style={styles.memberName} numberOfLines={1}>
                  {containerName(item)}
                </Text>
                <Text style={styles.memberStatus}>{titleCase(containerStatusLabel(item))}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            ))
          )}
        </View>

        {webUrl ? (
          <TouchableOpacity style={styles.webLink} onPress={() => Linking.openURL(webUrl)}>
            <Text style={styles.webLinkText}>Open in Portainer</Text>
            <Ionicons name="open-outline" size={14} color={colors.portainer} />
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.textSecondary, textAlign: 'center' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8 },
  iconButton: { padding: 8, width: 38 },
  topBarTitle: { flex: 1, textAlign: 'center', color: colors.textPrimary, fontWeight: '700', fontSize: 17 },
  container: { padding: 16, gap: 14, paddingBottom: 40 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, gap: 4 },
  sectionLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  rowLabel: { color: colors.textSecondary, fontSize: 13 },
  rowValue: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  toggleButton: { borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginTop: 10 },
  toggleButtonText: { fontWeight: '700', fontSize: 14 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  memberRowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  memberName: { flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  memberStatus: { color: colors.textSecondary, fontSize: 13 },
  webLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8 },
  webLinkText: { color: colors.portainer, fontSize: 13, fontWeight: '600' },
});
