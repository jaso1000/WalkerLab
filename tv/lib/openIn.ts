// "Open in Wholphin" / "Open in Plex" from the TV detail pages.
//
// Wholphin (Jellyfin client): its wholphin://search link with the title - an exact item page needs a
// Jellyfin item id, and WalkerLab profiles hold no Jellyfin server, so this lands on Wholphin's search
// with the title filled in (one press from the show).
//
// Plex: the app takes https://watch.plex.tv/{movie|show}/{slug} links and opens that title's page,
// which shows whether your server has it. The slug comes from Plex's public Discover search (no
// token), matched on type, title and year - the slug alone is ambiguous ("travel-guides" is a 2015
// show, "travel-guides-au" the 2017 one). If Plex is cold-starting into its "Who's watching?" picker
// it can drop the link; pressing the button again then works.
import * as IntentLauncher from 'expo-intent-launcher';
import { MediaKind } from '../../src/lib/discoverCategories';

// expo-intent-launcher only targets an app when given its activity class too (packageName alone is
// ignored), so each app's link-handling activity is named here.
const WHOLPHIN = { packageName: 'com.github.damontecres.wholphin', className: 'com.github.damontecres.wholphin.MainActivity' };
const PLEX = { packageName: 'com.plexapp.android', className: 'tv.plex.app.MainActivity' };

/**
 * Starts the activity. startActivityAsync's promise only settles when the user comes back to this app,
 * so wait just long enough to catch an immediate failure (app not installed) and then treat it as
 * launched, rather than leaving the button spinning while the other app is on screen.
 */
async function launch(action: string, params: IntentLauncher.IntentLauncherParams): Promise<void> {
  const started = IntentLauncher.startActivityAsync(action, params);
  started.catch(() => {});
  await Promise.race([started.then(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, 1200))]);
}

export async function openInWholphin(title: string): Promise<void> {
  await launch('android.intent.action.SEARCH', {
    ...WHOLPHIN,
    data: `wholphin://search?query=${encodeURIComponent(title)}`,
    extra: { query: title },
  });
}

const norm = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');

interface PlexHit {
  type?: string;
  title?: string;
  year?: number;
  slug?: string;
}

/** Finds the title's watch.plex.tv slug: same type, then the closest title and year. */
export async function findPlexSlug(title: string, year: number | undefined, kind: MediaKind): Promise<string | null> {
  const type = kind === 'movie' ? 'movie' : 'show';
  const url =
    'https://discover.provider.plex.tv/library/search?searchProviders=discover&limit=15' +
    `&searchTypes=${kind === 'movie' ? 'movies' : 'tv'}&query=${encodeURIComponent(title)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Plex search failed (${res.status})`);
  const body = await res.json();
  const hits: PlexHit[] = (body?.MediaContainer?.SearchResults ?? []).flatMap(
    (g: { SearchResult?: { Metadata?: PlexHit }[] }) => (g.SearchResult ?? []).map((r) => r.Metadata ?? {})
  );
  const candidates = hits.filter((h) => h.type === type && h.slug);
  const want = norm(title);
  const score = (h: PlexHit) => {
    let s = 0;
    const t = norm(h.title ?? '');
    if (t === want) s += 4;
    else if (t.startsWith(want) || want.startsWith(t)) s += 2;
    if (year && h.year) s += h.year === year ? 3 : Math.abs(h.year - year) === 1 ? 1 : -2;
    return s;
  };
  const best = candidates.sort((a, b) => score(b) - score(a))[0];
  return best && score(best) >= 3 ? best.slug! : null;
}

export async function openInPlex(title: string, year: number | undefined, kind: MediaKind): Promise<void> {
  const slug = await findPlexSlug(title, year, kind);
  if (!slug) throw new Error(`Couldn't find “${title}” on Plex`);
  await launch('android.intent.action.VIEW', {
    ...PLEX,
    data: `https://watch.plex.tv/${kind === 'movie' ? 'movie' : 'show'}/${slug}`,
  });
}
