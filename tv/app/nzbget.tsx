// NZBGet on the TV - see tv/components/DownloadClientView.
import { colors } from '../../src/theme/colors';
import { DownloadClientView } from '../components/DownloadClientView';
import { useEnabledServers } from '../lib/useEnabledServers';

export default function TvNZBGet() {
  const { servers } = useEnabledServers();
  return <DownloadClientView client="nzbget" config={servers.nzbget} tint={colors.nzbget} sectionId="nzbget" label="NZBGet" />;
}
