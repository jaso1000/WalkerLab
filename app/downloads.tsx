import { DownloadClientScreen } from '../src/components/DownloadClientScreen';
import { useServers } from '../src/context/ServersContext';
import { colors } from '../src/theme/colors';

// SABnzbd's own Downloads section - see src/components/DownloadClientScreen.tsx
// for the actual screen (shared with app/nzbget.tsx, NZBGet's equivalent).
export default function DownloadsScreen() {
  const { servers } = useServers();
  return (
    <DownloadClientScreen
      client="sabnzbd"
      config={servers.sabnzbd}
      tint={colors.sabnzbd}
      sectionId="downloads"
      notConfiguredLabel="SABnzbd"
    />
  );
}
