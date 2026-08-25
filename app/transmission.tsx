import { TorrentClientScreen } from '../src/components/TorrentClientScreen';
import { useServers } from '../src/context/ServersContext';
import { colors } from '../src/theme/colors';

// Transmission's own section - independent from qBittorrent's Torrents,
// same reasoning NZBGet got its own section alongside SABnzbd (see
// sectionMeta.ts's comment): both are torrent clients, but each gets its
// own toggleable section rather than one screen picking whichever is
// configured.
export default function TransmissionScreen() {
  const { servers } = useServers();
  return (
    <TorrentClientScreen
      client="transmission"
      config={servers.transmission}
      tint={colors.transmission}
      sectionId="transmission"
      notConfiguredLabel="Transmission"
    />
  );
}
