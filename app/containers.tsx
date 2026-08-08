import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import {
  containerName,
  containerStackName,
  containerStatusLabel,
  parseContainerHealth,
  PortainerContainer,
  PortainerStack,
  portainerApi,
  stackTypeLabel,
} from '../src/api/portainer';
import { ActionSheet, ActionSheetOption } from '../src/components/ActionSheet';
import { Badge, BadgeTone } from '../src/components/Badge';
import { NotConfigured } from '../src/components/NotConfigured';
import { SortField, SortMenu } from '../src/components/SortMenu';
import { SwipeTabBar } from '../src/components/SwipeTabBar';
import { WebRefreshButton } from '../src/components/WebRefreshButton';
import { useServers } from '../src/context/ServersContext';
import { useSectionNames } from '../src/context/SectionNamesContext';
import { alert } from '../src/lib/alert';
import { titleCase } from '../src/lib/format';
import { confirmContainerAction, containerActionDefs, PortainerAction, runContainerAction } from '../src/lib/portainerActions';
import { chunk, useColumns, useContentWidth } from '../src/lib/responsive';
import { useTabBarClearance } from '../src/lib/tabBarClearance';
import { HeaderTitle } from '../src/components/HeaderTitle';
import { SECTION_META } from '../src/lib/sectionMeta';
import { colors } from '../src/theme/colors';

// Containers screen (Portainer) - Containers/Stacks swipeable tabs, mirroring
// Downloads' 2-tab structure (paged Animated.ScrollView + SwipeTabBar +
// responsive column chunking, different item shape per tab). Unlike
// Downloads/Torrents' per-item "..." menu, this screen's quick actions open
// on long-press per the original ask - matching the existing long-press
// pattern already used on TV Shows/Movies' series/movie rows.
const TABS = ['Containers', 'Stacks'] as const;

// Sort only applies to the Containers tab (State/Created aren't meaningful
// fields on a PortainerStack), matching TV Shows/Movies' pattern of only
// showing the sort pill on tabs it applies to.
type SortKey = 'name' | 'state' | 'created';
const SORT_FIELDS: SortField[] = [
  { key: 'name', label: 'Name' },
  { key: 'state', label: 'State' },
  { key: 'created', label: 'Created' },
];
// Name/State read naturally A-Z; Created reads naturally newest-first.
function defaultSortAsc(key: SortKey): boolean {
  return key !== 'created';
}
function sortValue(c: PortainerContainer, key: SortKey): string | number {
  if (key === 'name') return containerName(c).toLowerCase();
  if (key === 'state') return c.State;
  return c.Created;
}

// Health takes precedence over the raw run state when a container has a
// healthcheck configured, matching Portainer's own list view (a healthy
// container shows "healthy", not "running").
function containerTone(c: PortainerContainer): BadgeTone {
  const health = parseContainerHealth(c.Status);
  if (health === 'healthy') return 'success';
  if (health === 'unhealthy') return 'danger';
  if (health === 'starting') return 'info';
  if (c.State === 'running') return 'success';
  if (c.State === 'restarting') return 'info';
  if (c.State === 'exited' || c.State === 'dead') return 'danger';
  return 'muted'; // paused | created | removing
}

export default function ContainersScreen() {
  const { names } = useSectionNames();
  const { servers } = useServers();
  const config = servers.portainer;
  const width = useContentWidth();
  const columns = useColumns();
  const scrollRef = useRef<ScrollView>(null);
  const tabBarClearance = useTabBarClearance();
  const scrollX = useSharedValue(0);
  const onPagerScroll = useAnimatedScrollHandler((event) => {
    scrollX.value = event.contentOffset.x;
  });

  const [containers, setContainers] = useState<PortainerContainer[]>([]);
  const [stacks, setStacks] = useState<PortainerStack[]>([]);
  const [loadingContainers, setLoadingContainers] = useState(false);
  const [loadingStacks, setLoadingStacks] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ title: string; options: ActionSheetOption[] } | null>(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);

  const stacksLoaded = useRef(false);

  const loadContainers = useCallback(async () => {
    if (!config) return;
    setLoadingContainers(true);
    setError(null);
    try {
      setContainers(await portainerApi.listContainers(config));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load containers');
    } finally {
      setLoadingContainers(false);
    }
  }, [config]);

  const loadStacks = useCallback(async () => {
    if (!config) return;
    setLoadingStacks(true);
    try {
      setStacks(await portainerApi.listStacks(config));
      stacksLoaded.current = true;
    } catch (e) {
      alert('Failed to load stacks', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoadingStacks(false);
    }
  }, [config]);

  useFocusEffect(
    useCallback(() => {
      loadContainers();
      if (activeTab === 1) loadStacks();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadContainers])
  );

  const handleTabChange = (index: number) => {
    setActiveTab(index);
    if (index === 1) loadStacks();
  };

  const goToTab = (index: number) => {
    handleTabChange(index);
    scrollRef.current?.scrollTo({ x: index * width, animated: true });
  };

  // Web has no pull-to-refresh gesture (react-native-web doesn't implement
  // `RefreshControl`) - `WebRefreshButton` calls whichever load function the
  // currently-active tab actually needs, mirroring what each tab's own
  // `RefreshControl.onRefresh` already does.
  const refreshActiveTab = () => {
    if (activeTab === 1) loadStacks();
    else loadContainers();
  };

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    handleTabChange(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  // Runs one action, reloading the container list on success - shared by
  // every entry in the long-press menu below.
  const executeAction = async (id: string, action: PortainerAction, opts?: { pullLatestImage?: boolean }) => {
    if (!config) return;
    setBusy(true);
    try {
      await runContainerAction(config, id, action, opts);
      await loadContainers();
    } catch (e) {
      alert('Failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  // Only actions that make sense for the container's current state are
  // shown - a bottom sheet has no room for grayed-out entries the way the
  // detail page's button row does.
  const openContainerMenu = (item: PortainerContainer) => {
    if (!config) return;
    const name = containerName(item);
    const options: ActionSheetOption[] = containerActionDefs(item.State)
      .filter((def) => def.enabled)
      .map((def) => ({
        label: def.label,
        destructive: def.destructive,
        onPress: () => confirmContainerAction(def.key, name, (opts) => executeAction(item.Id, def.key, opts)),
      }));
    setMenu({ title: name, options });
  };

  // Tapping the currently-active sort field reverses direction (matching
  // TV Shows/Movies' own sort pill behavior); tapping a different one
  // switches to it with that field's natural default direction.
  const handleSortSelect = (key: string) => {
    const next = key as SortKey;
    if (sortKey === next) setSortAsc((v) => !v);
    else {
      setSortKey(next);
      setSortAsc(defaultSortAsc(next));
    }
  };

  const filteredContainers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q ? containers.filter((c) => containerName(c).toLowerCase().includes(q)) : containers;
    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (av === bv) return 0;
      const result = av < bv ? -1 : 1;
      return sortAsc ? result : -result;
    });
  }, [containers, search, sortKey, sortAsc]);

  const filteredStacks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? stacks.filter((s) => s.Name.toLowerCase().includes(q)) : stacks;
  }, [stacks, search]);

  const chunkedContainers = useMemo(() => chunk(filteredContainers, columns), [filteredContainers, columns]);
  const chunkedStacks = useMemo(() => chunk(filteredStacks, columns), [filteredStacks, columns]);

  if (!config) return <NotConfigured service="Containers" tint={colors.portainer} />;

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerLeft: () => null,
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerTintColor: colors.textPrimary,
          headerTitleAlign: 'left',
          headerTitle: () => <HeaderTitle icon={SECTION_META.containers.icon} tint={SECTION_META.containers.tint} title={names.containers} />,
        }}
      />
      <View style={styles.searchRow}>
        <View style={styles.searchInputWrapper}>
          <Ionicons name="search" size={16} color={colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder={activeTab === 0 ? 'Search containers...' : 'Search stacks...'}
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <View style={styles.statusBar}>
        <View style={styles.tabBar}>
          <SwipeTabBar
            tabs={TABS}
            activeTab={activeTab}
            onChange={goToTab}
            onSettle={handleTabChange}
            scrollX={scrollX}
            pageWidth={width}
            tint={colors.portainer}
          />
        </View>
        <View style={styles.statusRight}>
          <View style={styles.statusTextGroup}>
            <Text style={styles.statusValue}>
              {activeTab === 0
                ? `${filteredContainers.length} container${filteredContainers.length === 1 ? '' : 's'}`
                : `${filteredStacks.length} stack${filteredStacks.length === 1 ? '' : 's'}`}
            </Text>
          </View>
          <WebRefreshButton onPress={refreshActiveTab} tint={colors.portainer} />
        </View>
      </View>

      {activeTab === 0 ? (
        <TouchableOpacity style={styles.sortPill} onPress={() => setSortMenuOpen(true)}>
          <Text style={styles.sortPillText}>{SORT_FIELDS.find((f) => f.key === sortKey)?.label}</Text>
          <Ionicons name={sortAsc ? 'arrow-up' : 'arrow-down'} size={16} color={colors.portainer} />
        </TouchableOpacity>
      ) : null}

      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        snapToInterval={width}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        onScroll={onPagerScroll}
        scrollEventThrottle={16}
        style={styles.pager}
      >
        <View style={[styles.page, { width }]}>
          <FlatList
            data={chunkedContainers}
            keyExtractor={(row) => row.map((c) => c.Id).join('-')}
            refreshControl={<RefreshControl tintColor={colors.portainer} refreshing={loadingContainers} onRefresh={loadContainers} />}
            contentContainerStyle={[filteredContainers.length === 0 ? styles.emptyContainer : styles.list, { paddingBottom: tabBarClearance }]}
            ListEmptyComponent={
              !loadingContainers ? (
                <Text style={styles.empty}>{error ?? (search ? `No containers match "${search}".` : 'No containers found.')}</Text>
              ) : null
            }
            initialNumToRender={16}
            maxToRenderPerBatch={16}
            windowSize={7}
            renderItem={({ item: row }) => (
              <View style={styles.row}>
                {row.map((item) => {
                  const stackName = containerStackName(item);
                  return (
                    <Pressable
                      key={item.Id}
                      style={[styles.card, styles.rowItem]}
                      disabled={busy}
                      onPress={() => router.push(`/containers/${item.Id}`)}
                      onLongPress={() => openContainerMenu(item)}
                    >
                      <Text style={styles.title} numberOfLines={1}>
                        {containerName(item)}
                      </Text>
                      <View style={styles.badgeRow}>
                        <Badge label={titleCase(containerStatusLabel(item))} tone={containerTone(item)} />
                        {stackName ? (
                          <Text style={styles.subtitle} numberOfLines={1}>
                            {stackName}
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
          />
        </View>

        <View style={[styles.page, { width }]}>
          <FlatList
            data={chunkedStacks}
            keyExtractor={(row) => row.map((s) => s.Id).join('-')}
            refreshControl={<RefreshControl tintColor={colors.portainer} refreshing={loadingStacks} onRefresh={loadStacks} />}
            contentContainerStyle={[filteredStacks.length === 0 ? styles.emptyContainer : styles.list, { paddingBottom: tabBarClearance }]}
            ListEmptyComponent={
              !loadingStacks ? (
                <Text style={styles.empty}>{search ? `No stacks match "${search}".` : 'No stacks found.'}</Text>
              ) : null
            }
            initialNumToRender={16}
            maxToRenderPerBatch={16}
            windowSize={7}
            renderItem={({ item: row }) => (
              <View style={styles.row}>
                {row.map((stack) => (
                  <Pressable key={stack.Id} style={[styles.card, styles.rowItem]} onPress={() => router.push(`/stacks/${stack.Id}`)}>
                    <Text style={styles.title} numberOfLines={1}>
                      {stack.Name}
                    </Text>
                    <View style={styles.badgeRow}>
                      <Badge label={stackTypeLabel(stack.Type)} tone="info" />
                      {stack.Status === 2 ? <Badge label="Inactive" tone="muted" /> : null}
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
          />
        </View>
      </Animated.ScrollView>

      {menu ? <ActionSheet visible title={menu.title} options={menu.options} onClose={() => setMenu(null)} /> : null}

      <SortMenu
        visible={sortMenuOpen}
        fields={SORT_FIELDS}
        activeKey={sortKey}
        activeAsc={sortAsc}
        onSelect={handleSortSelect}
        onClose={() => setSortMenuOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginTop: 8 },
  searchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    paddingHorizontal: 16,
    height: 48,
  },
  // 16px avoids iOS Safari's auto-zoom-on-focus for small inputs - see movies.tsx.
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 16 },
  sortPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  sortPillText: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  statusBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 12 },
  tabBar: {},
  // See app/index.tsx's identical comment - fixes "can't scroll"
  // on the web build without affecting native.
  pager: { flex: 1 },
  page: { flex: 1 },
  statusRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusTextGroup: { alignItems: 'flex-end' },
  statusValue: { color: colors.portainer, fontSize: 16, fontWeight: '700' },
  list: { paddingHorizontal: 12, paddingBottom: 24, gap: 10 },
  row: { flexDirection: 'row', gap: 10 },
  // `minWidth: 0` - react-native-web flex items default to `min-width: auto`
  // and refuse to shrink below their own content's natural width, which can
  // force a card past its 1/columns share of the row (see the fuller
  // explanation on this same style in movies.tsx/index.tsx).
  rowItem: { flex: 1, minWidth: 0 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 14 },
  title: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  subtitle: { fontSize: 13, color: colors.textSecondary },
  empty: { textAlign: 'center', marginTop: 40, color: colors.textSecondary },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
});
