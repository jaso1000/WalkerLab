// Container detail page (Portainer) - name/state/stack/image/created/IP/
// published ports/ownership plus the same action set the list's long-press
// menu offers, shown here as inline buttons (some disabled, matching the
// reference screenshot's grayed-out buttons for actions that don't apply to
// the container's current state) instead of a bottom sheet, and a link out
// to Portainer's own web UI to edit the container directly.
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  containerIpAddress,
  containerName,
  containerStackName,
  containerStatusLabel,
  containerUptimeLabel,
  containerWebUrl,
  ownershipLabel,
  PortainerContainer,
  portainerApi,
  publishedPorts,
} from '../../src/api/portainer';
import { useServers } from '../../src/context/ServersContext';
import { alert } from '../../src/lib/alert';
import { formatUnixDateTime, titleCase } from '../../src/lib/format';
import { confirmContainerAction, containerActionDefs, PortainerAction, runContainerAction } from '../../src/lib/portainerActions';
import { useTabBarClearance } from '../../src/lib/tabBarClearance';
import { colors } from '../../src/theme/colors';

export default function ContainerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tabBarClearance = useTabBarClearance();
  const { servers } = useServers();
  const config = servers.portainer;

  const [container, setContainer] = useState<PortainerContainer | null>(null);
  const [webUrl, setWebUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Reuses the list endpoint rather than a separate inspect call - its flat
  // `Ports` array and unix `Created` field are what every helper here
  // (publishedPorts, formatUnixDateTime) already expects, and it's the same
  // data the list screen just fetched a moment ago.
  const load = useCallback(async () => {
    if (!config || !id) return;
    setLoading(true);
    try {
      const [list, envId] = await Promise.all([portainerApi.listContainers(config), portainerApi.getPrimaryEndpointId(config)]);
      const match = list.find((c) => c.Id === id) ?? null;
      setContainer(match);
      setWebUrl(match ? containerWebUrl(config, envId, match.Id) : null);
    } catch (e) {
      alert('Failed to load container', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [config, id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const executeAction = async (action: PortainerAction, opts?: { pullLatestImage?: boolean }) => {
    if (!config || !container) return;
    setBusy(true);
    try {
      await runContainerAction(config, container.Id, action, opts);
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

  if (loading && !container) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.portainer} />
      </View>
    );
  }

  if (!container) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Container not found.</Text>
      </View>
    );
  }

  const name = containerName(container);
  const stackName = containerStackName(container);
  const ip = containerIpAddress(container);
  const ports = publishedPorts(container);
  const uptime = containerUptimeLabel(container.Status);
  const host = (() => {
    try {
      return new URL(config.baseUrl).hostname;
    } catch {
      return null;
    }
  })();

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle} numberOfLines={1}>
          {name}
        </Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.container, { paddingBottom: tabBarClearance }]}>
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>ACTIONS</Text>
          <View style={styles.actionsRow}>
            {containerActionDefs(container.State).map((def) => (
              <TouchableOpacity
                key={def.key}
                style={[styles.actionButton, !def.enabled && styles.actionButtonDisabled]}
                disabled={!def.enabled || busy}
                onPress={() => confirmContainerAction(def.key, name, (opts) => executeAction(def.key, opts))}
              >
                <Text
                  style={[
                    styles.actionButtonText,
                    def.destructive && styles.actionButtonTextDestructive,
                    !def.enabled && styles.actionButtonTextDisabled,
                  ]}
                >
                  {def.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>CONTAINER STATUS</Text>
          <DetailRow label="Name" value={name} />
          <DetailRow label="Status" value={titleCase(containerStatusLabel(container))} />
          {uptime ? <DetailRow label="Uptime" value={uptime} /> : null}
          {stackName ? <DetailRow label="Stack" value={stackName} /> : null}
          <DetailRow label="Image" value={container.Image} />
          <DetailRow label="Created" value={formatUnixDateTime(container.Created)} />
          <DetailRow label="IP Address" value={ip ?? '-'} />
          <DetailRow label="Ownership" value={ownershipLabel(container.Portainer?.ResourceControl)} />
          {ports.length > 0 ? (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Published Ports</Text>
              <View style={styles.portsWrap}>
                {ports.map((port) => (
                  <TouchableOpacity
                    key={port}
                    onPress={() => host && Linking.openURL(`http://${host}:${port.split(':')[0]}`)}
                    disabled={!host}
                  >
                    <Text style={styles.portLink}>{port}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : null}
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

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
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
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionButton: { backgroundColor: colors.surfaceAlt, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  actionButtonDisabled: { opacity: 0.4 },
  actionButtonText: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
  actionButtonTextDestructive: { color: colors.danger },
  actionButtonTextDisabled: { color: colors.textMuted },
  row: { paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, gap: 4 },
  rowLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  rowValue: { color: colors.textPrimary, fontSize: 15 },
  portsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  portLink: { color: colors.portainer, fontSize: 15, fontWeight: '600' },
  webLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8 },
  webLinkText: { color: colors.portainer, fontSize: 13, fontWeight: '600' },
});
