// One service's connection on the TV (the phone's app/settings/[service]): the section's name in the
// rail (with Reset), URL, username/password where the service logs in that way, API key, TMDB's
// default streaming region, then Test connection and Save. A self-signed HTTPS server that fails the
// test offers its certificate to trust, as on the phone. Text fields take the Google TV phone app's
// keyboard, so addresses and keys can be pasted rather than typed with the remote.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { getCertificateInfo } from '../../../modules/tls-trust';
import { lastfmApi } from '../../../src/api/lastfm';
import { lidarrApi } from '../../../src/api/lidarr';
import { nzbgetApi } from '../../../src/api/nzbget';
import { omdbApi } from '../../../src/api/omdb';
import { overseerrApi } from '../../../src/api/overseerr';
import { portainerApi } from '../../../src/api/portainer';
import { qbittorrentApi } from '../../../src/api/qbittorrent';
import { radarrApi } from '../../../src/api/radarr';
import { sabnzbdApi } from '../../../src/api/sabnzbd';
import { sonarrApi } from '../../../src/api/sonarr';
import { tautulliApi } from '../../../src/api/tautulli';
import { tmdbApi } from '../../../src/api/tmdb';
import { transmissionApi } from '../../../src/api/transmission';
import { ServiceConfig, ServiceName } from '../../../src/api/types';
import { useProfiles } from '../../../src/context/ProfilesContext';
import { useSectionNames } from '../../../src/context/SectionNamesContext';
import { useServers } from '../../../src/context/ServersContext';
import { alert } from '../../../src/lib/alert';
import { FALLBACK_WATCH_REGION, getDefaultRegion, setDefaultRegion } from '../../../src/lib/preferences';
import { DEFAULT_SECTION_NAMES } from '../../../src/lib/sectionNames';
import { SERVICE_META } from '../../../src/lib/serviceMeta';
import { colors } from '../../../src/theme/colors';
import { ActionButton } from '../../components/Detail';
import { errText, Message, ScreenHeader, SIDE, TV_LIST, TvTextField } from '../../components/ui';

const TEST_CONNECTION: Record<ServiceName, (config: ServiceConfig) => Promise<unknown>> = {
  sonarr: sonarrApi.testConnection,
  radarr: radarrApi.testConnection,
  lidarr: lidarrApi.testConnection,
  sabnzbd: sabnzbdApi.testConnection,
  nzbget: nzbgetApi.testConnection,
  tmdb: tmdbApi.testConnection,
  omdb: omdbApi.testConnection,
  lastfm: lastfmApi.testConnection,
  overseerr: overseerrApi.testConnection,
  qbittorrent: qbittorrentApi.testConnection,
  transmission: transmissionApi.testConnection,
  tautulli: tautulliApi.testConnection,
  portainer: portainerApi.testConnection,
};

function normalize(config: ServiceConfig): ServiceConfig {
  return {
    baseUrl: config.baseUrl.trim().replace(/\/+$/, ''),
    apiKey: config.apiKey.trim(),
    username: config.username?.trim() || undefined,
    password: config.password || undefined,
    trustedCertFingerprint: config.trustedCertFingerprint || undefined,
    profileId: config.profileId,
  };
}

function Label({ children }: { children: string }) {
  return <Text style={{ color: colors.textMuted, fontSize: 12, letterSpacing: 1.5, marginTop: 16, marginBottom: 8 }}>{children}</Text>;
}

export default function TvServiceSettings() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const meta = SERVICE_META.find((s) => s.name === name);
  const { activeProfileId } = useProfiles();
  const { servers, updateServer, refresh } = useServers();
  const { names, setName, resetName } = useSectionNames();
  const existing = meta ? servers[meta.name] : undefined;

  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState(existing?.apiKey ?? '');
  const [username, setUsername] = useState(existing?.username ?? '');
  const [password, setPassword] = useState(existing?.password ?? '');
  const [fingerprint, setFingerprint] = useState(existing?.trustedCertFingerprint ?? '');
  const [sectionName, setSectionName] = useState(meta?.sectionId ? names[meta.sectionId] : '');
  const [region, setRegion] = useState(FALLBACK_WATCH_REGION);

  useEffect(() => {
    if (meta?.name === 'tmdb') getDefaultRegion().then(setRegion).catch(() => {});
  }, [meta?.name]);

  if (!meta) return <Message text="Unknown service." error />;

  const current = (fp = fingerprint) => normalize({ baseUrl, apiKey, username, password, trustedCertFingerprint: fp, profileId: activeProfileId });
  const canSave = (!meta.requiresUrl || baseUrl.trim().length > 0) && (meta.apiKeyOptional || apiKey.trim().length > 0 || existing?.hasApiKey === true);

  const save = async () => {
    if (!canSave) return alert('Missing details', meta.requiresUrl ? 'Enter the address and API key.' : 'Enter the API key.');
    try {
      if (meta.sectionId && sectionName.trim() && sectionName.trim() !== names[meta.sectionId]) setName(meta.sectionId, sectionName.trim());
      await updateServer(meta.name, current());
      await refresh();
      alert('Saved', `${meta.label} settings saved.`);
      router.back();
    } catch (e) {
      alert('Save failed', errText(e));
    }
  };

  const offerCertTrust = async (): Promise<boolean> => {
    let host: string;
    let port: number;
    try {
      const u = new URL(baseUrl.trim());
      host = u.hostname;
      port = Number(u.port) || 443;
    } catch {
      return false;
    }
    const cert = await getCertificateInfo(host, port);
    if (!cert) return false;
    alert(
      'Certificate Not Trusted',
      `${meta.label} is reachable, but its certificate isn't automatically trusted (most likely self-signed):\n\nSubject: ${cert.subject}\nIssuer: ${cert.issuer}\nValid: ${cert.notBefore} – ${cert.notAfter}\nFingerprint: ${cert.sha256}\n\nOnly trust this if you recognize this server.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Trust This Certificate',
          onPress: () => {
            setFingerprint(cert.sha256);
            test(cert.sha256);
          },
        },
      ]
    );
    return true;
  };

  const test = async (fp = fingerprint) => {
    try {
      await TEST_CONNECTION[meta.name](current(fp));
      alert('Success', `Connected to ${meta.label}.`);
    } catch (e) {
      if (meta.supportsCertTrust && !fp && baseUrl.trim().toLowerCase().startsWith('https://') && (await offerCertTrust())) return;
      alert('Connection failed', errText(e));
    }
  };

  const pickRegion = async () => {
    try {
      const regions = (await tmdbApi.watchProviderRegions(current())).sort((a, b) => a.english_name.localeCompare(b.english_name));
      alert('Streaming region', undefined, [
        ...regions.map((r) => ({
          text: `${r.english_name} (${r.iso_3166_1})`,
          onPress: () => {
            setRegion(r.iso_3166_1);
            setDefaultRegion(r.iso_3166_1);
          },
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    } catch (e) {
      alert('Failed', errText(e));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title={meta.label} tint={meta.tint} subtitle={existing ? 'Connected' : 'Not set up'} />
      <ScrollView {...TV_LIST} contentContainerStyle={{ paddingHorizontal: SIDE, paddingBottom: 40, maxWidth: 820 }}>
        <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20 }}>{meta.description}</Text>

        {meta.sectionId ? (
          <>
            <Label>SECTION NAME</Label>
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <TvTextField value={sectionName} onChangeText={setSectionName} placeholder={meta.label} style={{ flex: 1 }} />
              <ActionButton
                icon="refresh"
                label="Reset"
                tint={meta.tint}
                onPress={() => {
                  resetName(meta.sectionId!);
                  setSectionName(DEFAULT_SECTION_NAMES[meta.sectionId!]);
                }}
              />
            </View>
          </>
        ) : null}

        {meta.requiresUrl ? (
          <>
            <Label>URL</Label>
            <TvTextField value={baseUrl} onChangeText={setBaseUrl} placeholder={meta.placeholder} preferredFocus />
            {meta.urlTemplate ? <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 6 }}>{meta.urlTemplate}</Text> : null}
          </>
        ) : null}

        {meta.usesCredentials ? (
          <>
            <Label>USERNAME</Label>
            <TvTextField value={username} onChangeText={setUsername} placeholder="Username" />
            <Label>PASSWORD</Label>
            <TvTextField value={password} onChangeText={setPassword} placeholder={existing?.hasPassword ? 'Currently set — leave blank to keep' : 'Password'} secure />
          </>
        ) : null}

        <Label>{meta.usesCredentials ? 'API KEY (OPTIONAL)' : 'API KEY'}</Label>
        <TvTextField value={apiKey} onChangeText={setApiKey} placeholder={existing?.hasApiKey ? 'Currently set — leave blank to keep' : 'API key'} preferredFocus={!meta.requiresUrl} />

        {meta.supportsCertTrust && fingerprint ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 13, flex: 1 }} numberOfLines={1}>
              Trusting certificate {fingerprint}
            </Text>
            <ActionButton icon="close-circle-outline" label="Forget" tint={colors.danger} onPress={() => setFingerprint('')} />
          </View>
        ) : null}

        {meta.name === 'tmdb' && existing ? (
          <>
            <Label>STREAMING REGION</Label>
            <View style={{ flexDirection: 'row' }}>
              <ActionButton icon="globe-outline" label={region} tint={meta.tint} onPress={pickRegion} />
            </View>
          </>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 14, marginTop: 26 }}>
          <ActionButton icon="pulse" label="Test connection" tint={meta.tint} onPress={() => test()} />
          <ActionButton icon="save-outline" label="Save" tint={meta.tint} primary onPress={save} />
        </View>
      </ScrollView>
    </View>
  );
}

