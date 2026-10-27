// Containers (Portainer) on the TV, as the phone's app/containers.tsx: Containers and Stacks tabs.
// OK on a container shows its details (status, image, stack, IP, ports) with the actions its state
// allows - the phone's shared containerActionDefs / confirmContainerAction / runContainerAction, so
// Remove and Recreate (with or without pulling the latest image) confirm exactly as on the phone.
// OK on a stack lists its containers and starts or stops it; "Show its containers" narrows the
// Containers tab to that stack (the phone's stack page).
import { useState } from 'react';
import { FlatList } from 'react-native';
import {
  containerIpAddress,
  containerName,
  containerStackName,
  containerStatusLabel,
  portainerApi,
  PortainerContainer,
  PortainerStack,
  publishedPorts,
  stackTypeLabel,
} from '../../src/api/portainer';
import { useSectionNames } from '../../src/context/SectionNamesContext';
import { alert } from '../../src/lib/alert';
import { confirmContainerAction, containerActionDefs, runContainerAction } from '../../src/lib/portainerActions';
import { colors } from '../../src/theme/colors';
import { listStyles } from '../components/DownloadClientView';
import { Shell } from '../components/Shell';
import { errText, ListFrame, ListRow, Loading, Message, NotConfigured, ScreenHeader, SmallButton, TV_LIST, useLoad, usePoll } from '../components/ui';
import { useEnabledServers } from '../lib/useEnabledServers';

const TABS = ['Containers', 'Stacks'] as const;

const stateColor = (state: string) =>
  state === 'running' ? colors.success : state === 'paused' ? colors.accent : state === 'restarting' ? colors.info : colors.textMuted;

export default function TvContainers() {
  const { names } = useSectionNames();
  const { servers, ready } = useEnabledServers();
  const config = servers.portainer;
  const tint = colors.portainer;
  const [tab, setTab] = useState(0);
  // A stack's "Show its containers" narrows the Containers tab to that stack (the phone's stack page).
  const [stackFilter, setStackFilter] = useState<string | null>(null);
  const containers = useLoad(
    () => portainerApi.listContainers(config!).then((l) => [...l].sort((a, b) => containerName(a).localeCompare(containerName(b)))),
    [config],
    !!config
  );
  const stacks = useLoad(() => portainerApi.listStacks(config!), [config], !!config && tab === 1);
  usePoll(containers.reload, 10_000, !!config && tab === 0);

  if (ready && !config) {
    return (
      <Shell active="containers">
        <NotConfigured service="Portainer" />
      </Shell>
    );
  }

  const openContainer = (c: PortainerContainer) => {
    const name = containerName(c);
    const details = [
      containerStatusLabel(c),
      c.Image,
      containerStackName(c) && `Stack: ${containerStackName(c)}`,
      containerIpAddress(c) && `IP: ${containerIpAddress(c)}`,
      publishedPorts(c).length ? `Ports: ${publishedPorts(c).join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    alert(name, details, [
      ...containerActionDefs(c.State)
        .filter((d) => d.enabled)
        .map((d) => ({
          text: d.label,
          style: d.destructive ? ('destructive' as const) : ('default' as const),
          onPress: () =>
            confirmContainerAction(d.key, name, async (opts) => {
              try {
                await runContainerAction(config!, c.Id, d.key, opts);
                containers.reload();
              } catch (e) {
                alert('Failed', errText(e));
              }
            }),
        })),
      { text: 'Close', style: 'cancel' as const },
    ]);
  };

  const openStack = (s: PortainerStack) => {
    const active = s.Status === 1;
    const members = (containers.data ?? []).filter((c) => containerStackName(c) === s.Name);
    const memberLines = members.map((c) => `${containerName(c)} - ${containerStatusLabel(c)}`).join('\n');
    alert(s.Name, `${stackTypeLabel(s.Type)} stack · ${active ? 'Active' : 'Inactive'}${memberLines ? `\n\n${memberLines}` : ''}`, [
      ...(members.length
        ? [
            {
              text: 'Show its containers',
              onPress: () => {
                setStackFilter(s.Name);
                setTab(0);
              },
            },
          ]
        : []),
      {
        text: active ? 'Stop stack' : 'Start stack',
        style: active ? 'destructive' : 'default',
        onPress: async () => {
          try {
            if (active) await portainerApi.stopStack(config!, s);
            else await portainerApi.startStack(config!, s);
            stacks.reload();
            containers.reload();
          } catch (e) {
            alert('Failed', errText(e));
          }
        },
      },
      { text: 'Close', style: 'cancel' },
    ]);
  };

  const list = tab === 0 ? containers : stacks;
  const running = (containers.data ?? []).filter((c) => c.State === 'running').length;

  return (
    <Shell active="containers">
      <ScreenHeader
        title={names.containers}
        tint={tint}
        count={tab === 0 ? containers.data?.length : stacks.data?.length}
        subtitle={tab === 0 && containers.data ? (stackFilter ? `Stack: ${stackFilter}` : `${running} running`) : undefined}
        right={tab === 0 && stackFilter ? <SmallButton icon="close" label="All containers" tint={tint} onPress={() => setStackFilter(null)} /> : undefined}
        tabs={TABS}
        active={tab}
        onTab={setTab}
      />
      {list.loading ? (
        <Loading tint={tint} />
      ) : list.error && !list.data ? (
        <Message text={list.error} error />
      ) : tab === 0 ? (
        <ListFrame>
          <FlatList
            {...TV_LIST}
            data={(containers.data ?? []).filter((c) => !stackFilter || containerStackName(c) === stackFilter)}
            keyExtractor={(c) => c.Id}
            contentContainerStyle={listStyles.list}
            ListEmptyComponent={<Message text="No containers found." />}
            renderItem={({ item: c }) => (
              <ListRow
                title={containerName(c)}
                subtitle={[c.Image, containerStackName(c)].filter(Boolean).join('  ·  ')}
                meta={containerStatusLabel(c)}
                metaColor={stateColor(c.State)}
                icon="cube"
                tint={stateColor(c.State)}
                onPress={() => openContainer(c)}
              />
            )}
          />
        </ListFrame>
      ) : (
        <ListFrame>
          <FlatList
            {...TV_LIST}
            data={stacks.data ?? []}
            keyExtractor={(s) => String(s.Id)}
            contentContainerStyle={listStyles.list}
            ListEmptyComponent={<Message text="No stacks found." />}
            renderItem={({ item: s }) => (
              <ListRow
                title={s.Name}
                subtitle={stackTypeLabel(s.Type)}
                meta={s.Status === 1 ? 'Active' : 'Inactive'}
                metaColor={s.Status === 1 ? colors.success : colors.textMuted}
                icon="layers"
                tint={tint}
                onPress={() => openStack(s)}
              />
            )}
          />
        </ListFrame>
      )}
    </Shell>
  );
}
