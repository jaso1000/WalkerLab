// Settings on the TV (the phone's app/settings, settings/navigation and profiles), in three tabs:
// Services - every service with its address and on/off state; OK offers Edit connection (URL, key,
//   section name - tv/app/settings/service) and Turn on/off, which hides or shows its section.
// Section order - the rail's order; OK moves a section up or down (the phone's up/down buttons).
// Profiles - switch, add, restore from a phone backup (tv/app/setup) and delete.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, ScrollView, View } from 'react-native';
import { useProfiles } from '../../src/context/ProfilesContext';
import { useSectionNames } from '../../src/context/SectionNamesContext';
import { useServers } from '../../src/context/ServersContext';
import { useServiceEnabled } from '../../src/context/ServiceEnabledContext';
import { alert } from '../../src/lib/alert';
import { SECTION_META } from '../../src/lib/sectionMeta';
import { sectionEnabled, SERVICE_META } from '../../src/lib/serviceMeta';
import { StartupSectionId } from '../../src/lib/startupScreen';
import { DEFAULT_TAB_ORDER, getTabOrder, setTabOrder } from '../../src/lib/tabOrder';
import { colors } from '../../src/theme/colors';
import { listStyles } from '../components/DownloadClientView';
import { Shell } from '../components/Shell';
import { errText, ListFrame, ListRow, ScreenHeader, TV_LIST } from '../components/ui';
import { tabOrderChanged } from '../lib/sections';

const TABS = ['Services', 'Section order', 'Profiles'] as const;
const tint = colors.brand;

function Services() {
  const { servers } = useServers();
  const { isEnabled, setEnabled } = useServiceEnabled();
  return (
    <ListFrame>
      <FlatList
        {...TV_LIST}
        data={SERVICE_META}
        keyExtractor={(s) => s.name}
        contentContainerStyle={listStyles.list}
        renderItem={({ item: s, index }) => {
          const on = isEnabled(s.name);
          const config = servers[s.name];
          const configured = !!config && (!!config.baseUrl || !!config.apiKey || !!config.hasApiKey);
          return (
            <ListRow
              title={s.label}
              subtitle={configured ? config!.baseUrl || 'API key set' : 'Not set up'}
              meta={on ? 'On' : 'Off'}
              metaColor={on ? colors.success : colors.textMuted}
              icon={s.icon}
              tint={on ? s.tint : colors.textMuted}
              preferredFocus={index === 0}
              onPress={() =>
                alert(s.label, s.description, [
                  { text: 'Edit connection', onPress: () => router.push(`/settings/service?name=${s.name}` as never) },
                  { text: on ? 'Turn off' : 'Turn on', onPress: () => setEnabled(s.name, !on) },
                  { text: 'Cancel', style: 'cancel' },
                ])
              }
            />
          );
        }}
      />
    </ListFrame>
  );
}

function SectionOrder() {
  const { activeProfileId } = useProfiles();
  const { names } = useSectionNames();
  const { isEnabled } = useServiceEnabled();
  const [order, setOrder] = useState<StartupSectionId[]>(DEFAULT_TAB_ORDER);

  useEffect(() => {
    getTabOrder(activeProfileId).then(setOrder).catch(() => {});
  }, [activeProfileId]);

  const move = (index: number, by: -1 | 1) => {
    const target = index + by;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
    setTabOrder(activeProfileId, next).then(tabOrderChanged).catch(() => {});
  };

  return (
    <ScrollView {...TV_LIST} contentContainerStyle={listStyles.list}>
      {order.map((id, i) => {
        const on = sectionEnabled(id, isEnabled);
        return (
          <ListRow
            key={id}
            title={`${i + 1}.  ${names[id]}`}
            subtitle={on ? undefined : 'Hidden - its service is off'}
            icon={SECTION_META[id].icon}
            tint={on ? (SECTION_META[id].tint ?? colors.textSecondary) : colors.textMuted}
            preferredFocus={i === 0}
            onPress={() =>
              alert(names[id], undefined, [
                ...(i > 0 ? [{ text: 'Move up', onPress: () => move(i, -1) }] : []),
                ...(i < order.length - 1 ? [{ text: 'Move down', onPress: () => move(i, 1) }] : []),
                { text: 'Cancel', style: 'cancel' as const },
              ])
            }
          />
        );
      })}
    </ScrollView>
  );
}

function Profiles() {
  const { profiles, activeProfileId, switchProfile, addProfile, deleteProfile } = useProfiles();
  const run = (fn: () => Promise<unknown>) => fn().catch((e) => alert('Failed', errText(e)));
  return (
    <ScrollView {...TV_LIST} contentContainerStyle={listStyles.list}>
      {profiles.map((p, i) => {
        const active = p.id === activeProfileId;
        return (
          <ListRow
            key={p.id}
            title={p.name}
            meta={active ? 'Active' : undefined}
            metaColor={tint}
            icon="person-circle-outline"
            tint={active ? tint : colors.textSecondary}
            preferredFocus={i === 0}
            onPress={() =>
              alert(p.name, undefined, [
                ...(!active ? [{ text: 'Switch to this profile', onPress: () => run(() => switchProfile(p.id).then(() => router.replace('/'))) }] : []),
                ...(profiles.length > 1
                  ? [
                      {
                        text: 'Delete profile',
                        style: 'destructive' as const,
                        onPress: () =>
                          alert('Delete profile', `Delete "${p.name}" and every server saved in it from this TV?`, [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Delete', style: 'destructive', onPress: () => run(() => deleteProfile(p.id)) },
                          ]),
                      },
                    ]
                  : []),
                { text: 'Cancel', style: 'cancel' as const },
              ])
            }
          />
        );
      })}
      <ListRow title="Restore a profile from a phone backup" icon="cloud-download-outline" tint={tint} onPress={() => router.push('/setup' as never)} />
      <ListRow
        title="New empty profile"
        subtitle="Creates it and switches to it; then set up its services"
        icon="add-circle-outline"
        tint={tint}
        onPress={() => run(async () => {
          await addProfile(`Profile ${profiles.length + 1}`);
        })}
      />
    </ScrollView>
  );
}

export default function TvSettings() {
  const [tab, setTab] = useState(0);
  return (
    <Shell active="settings">
      <ScreenHeader title="Settings" tint={tint} tabs={TABS} active={tab} onTab={setTab} />
      <View style={{ flex: 1 }}>{tab === 0 ? <Services /> : tab === 1 ? <SectionOrder /> : <Profiles />}</View>
    </Shell>
  );
}
