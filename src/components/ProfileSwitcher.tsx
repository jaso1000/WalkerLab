// Self-contained profile-switcher sheet (checkmarks the active profile,
// plus Add/Manage actions) and its "New Profile" name-prompt follow-up -
// factored out of DrawerContent so the bottom Tabs bar's "More" sheet can
// open the exact same flow without duplicating it. Owns its own
// `addProfileOpen` state internally; callers only control the outer sheet's
// visibility.
import { router } from 'expo-router';
import { useState } from 'react';
import { ActionSheet, ActionSheetOption } from './ActionSheet';
import { PromptModal } from './PromptModal';
import { useProfiles } from '../context/ProfilesContext';
import { alert } from '../lib/alert';

export function ProfileSwitcher({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { profiles, activeProfile, switchProfile, addProfile } = useProfiles();
  const [addProfileOpen, setAddProfileOpen] = useState(false);

  const options: ActionSheetOption[] = [
    ...profiles.map((profile) => ({
      label: profile.id === activeProfile.id ? `✓  ${profile.name}` : profile.name,
      onPress: () => switchProfile(profile.id).catch((e) => alert('Failed to switch profile', e instanceof Error ? e.message : 'Unknown error')),
    })),
    { label: 'Add New Profile…', onPress: () => setAddProfileOpen(true) },
    { label: 'Manage Profiles…', onPress: () => router.push('/profiles') },
  ];

  return (
    <>
      <ActionSheet visible={visible} title="Switch Profile" options={options} onClose={onClose} />
      <PromptModal
        visible={addProfileOpen}
        title="New Profile"
        placeholder="e.g. Uncle Paul"
        confirmLabel="Create"
        onCancel={() => setAddProfileOpen(false)}
        onConfirm={(name) => {
          setAddProfileOpen(false);
          if (name.trim()) addProfile(name.trim()).catch((e) => alert('Failed to create profile', e instanceof Error ? e.message : 'Unknown error'));
        }}
      />
    </>
  );
}
