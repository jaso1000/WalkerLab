import { TorrentClientScreen } from '../src/components/TorrentClientScreen';
import { useServers } from '../src/context/ServersContext';
import { colors } from '../src/theme/colors';

export default function TorrentsScreen() {
  const { servers } = useServers();
  return (
    <TorrentClientScreen
      client="qbittorrent"
      config={servers.qbittorrent}
      tint={colors.qbittorrent}
      sectionId="torrents"
      notConfiguredLabel="qBittorrent"
    />
  );
}
