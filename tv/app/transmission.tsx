// Transmission on the TV - see tv/components/TorrentClientView.
import { colors } from '../../src/theme/colors';
import { TorrentClientView } from '../components/TorrentClientView';
import { useEnabledServers } from '../lib/useEnabledServers';

export default function TvTransmission() {
  const { servers } = useEnabledServers();
  return <TorrentClientView client="transmission" config={servers.transmission} tint={colors.transmission} sectionId="transmission" label="Transmission" />;
}
