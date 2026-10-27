// qBittorrent on the TV - see tv/components/TorrentClientView.
import { colors } from '../../src/theme/colors';
import { TorrentClientView } from '../components/TorrentClientView';
import { useEnabledServers } from '../lib/useEnabledServers';

export default function TvqBittorrent() {
  const { servers } = useEnabledServers();
  return <TorrentClientView client="qbittorrent" config={servers.qbittorrent} tint={colors.qbittorrent} sectionId="torrents" label="qBittorrent" />;
}
