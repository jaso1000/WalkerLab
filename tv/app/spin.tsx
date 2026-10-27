// Spin on the TV - the phone's app/spin.tsx: the profile's saved wheels; OK on one offers Spin, Edit
// or Delete (with confirmation); "New wheel" opens the builder. Wheels are the same per-profile
// storage the phone uses (src/lib/wheels).
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { FlatList } from 'react-native';
import { useProfiles } from '../../src/context/ProfilesContext';
import { useSectionNames } from '../../src/context/SectionNamesContext';
import { alert } from '../../src/lib/alert';
import { deleteWheel, getWheels, Wheel } from '../../src/lib/wheels';
import { colors } from '../../src/theme/colors';
import { listStyles } from '../components/DownloadClientView';
import { Shell } from '../components/Shell';
import { errText, ListFrame, ListRow, Loading, Message, ScreenHeader, SmallButton, TV_LIST, useLoad } from '../components/ui';

const tint = colors.spin;

export default function TvSpin() {
  const { names } = useSectionNames();
  const { activeProfileId } = useProfiles();
  const wheels = useLoad(() => getWheels(activeProfileId), [activeProfileId]);
  useFocusEffect(
    useCallback(() => {
      wheels.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const openMenu = (w: Wheel) =>
    alert(w.name, `${w.items.length} title${w.items.length === 1 ? '' : 's'}${w.removeAfterSpin ? ' · removes a title after landing on it' : ''}`, [
      { text: 'Spin', onPress: () => router.push(`/spin/${w.id}` as never) },
      { text: 'Edit', onPress: () => router.push(`/spin/builder?wheelId=${w.id}` as never) },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          alert('Delete Wheel', `Delete "${w.name}"? This can't be undone.`, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: async () => {
                try {
                  await deleteWheel(activeProfileId, w.id);
                  wheels.reload();
                } catch (e) {
                  alert('Failed to delete wheel', errText(e));
                }
              },
            },
          ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);

  return (
    <Shell active="spin">
      <ScreenHeader
        title={names.spin}
        tint={tint}
        count={wheels.data?.length}
        right={<SmallButton icon="add" label="New wheel" tint={tint} onPress={() => router.push('/spin/builder' as never)} />}
      />
      {wheels.loading ? (
        <Loading tint={tint} />
      ) : (
        <ListFrame>
          <FlatList
            {...TV_LIST}
            data={wheels.data ?? []}
            keyExtractor={(w) => w.id}
            contentContainerStyle={listStyles.list}
            ListEmptyComponent={<Message text={wheels.error ?? 'No wheels yet - make one with "New wheel".'} error={!!wheels.error} />}
            renderItem={({ item: w, index }) => (
              <ListRow
                title={w.name}
                subtitle={w.items.slice(0, 4).map((i) => i.title).join(', ') + (w.items.length > 4 ? '…' : '')}
                meta={`${w.items.length} titles`}
                metaColor={tint}
                icon="shuffle"
                tint={tint}
                preferredFocus={index === 0}
                onPress={() => openMenu(w)}
              />
            )}
          />
        </ListFrame>
      )}
    </Shell>
  );
}
