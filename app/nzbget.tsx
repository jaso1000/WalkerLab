import { DownloadClientScreen } from '../src/components/DownloadClientScreen';
import { useServers } from '../src/context/ServersContext';
import { colors } from '../src/theme/colors';

// NZBGet's own section - independent from SABnzbd's Downloads (they're both
// Usenet clients, but each gets its own toggleable section rather than one
// screen picking whichever is configured, per the user's own preference).
// See src/components/DownloadClientScreen.tsx for the actual screen.
export default function NzbgetScreen() {
  const { servers } = useServers();
  return (
    <DownloadClientScreen
      client="nzbget"
      config={servers.nzbget}
      tint={colors.nzbget}
      sectionId="nzbget"
      notConfiguredLabel="NZBGet"
    />
  );
}
