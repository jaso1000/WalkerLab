// One Tautulli user's play history, opened from Stats > Users (the phone's app/tautulli/user/[id]).
import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { colors } from '../../../src/theme/colors';
import { screenErrorBoundary } from '../../components/ScreenError';
import { HistoryList } from '../../components/TautulliHistory';
import { Loading, ScreenHeader } from '../../components/ui';
import { useEnabledServers } from '../../lib/useEnabledServers';

export const ErrorBoundary = screenErrorBoundary('stats', 'Watch history', colors.tautulli);

export default function TvStatsUser() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { servers } = useEnabledServers();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title={name ?? 'User'} tint={colors.tautulli} subtitle="Play history" />
      {servers.tautulli ? <HistoryList config={servers.tautulli} tint={colors.tautulli} userId={Number(id)} /> : <Loading tint={colors.tautulli} />}
    </View>
  );
}
