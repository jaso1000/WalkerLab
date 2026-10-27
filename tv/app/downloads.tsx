// SABnzbd on the TV - see tv/components/DownloadClientView.
import { colors } from '../../src/theme/colors';
import { DownloadClientView } from '../components/DownloadClientView';
import { useEnabledServers } from '../lib/useEnabledServers';

export default function TvSABnzbd() {
  const { servers } = useEnabledServers();
  return <DownloadClientView client="sabnzbd" config={servers.sabnzbd} tint={colors.sabnzbd} sectionId="downloads" label="SABnzbd" />;
}
