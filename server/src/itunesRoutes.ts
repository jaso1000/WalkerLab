// Keyless passthroughs to two of Apple's public catalog endpoints, used by
// the Music Discover tab (src/api/itunes.ts's web branch). Neither needs a
// stored config - there's no API key for either - these routes exist only
// because neither endpoint sends CORS headers for arbitrary browser origins
// (confirmed live), so the web build can't call them directly the way
// native does.
import { Router } from 'express';

const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';
const NEW_RELEASES_URL = 'https://rss.marketingtools.apple.com/api/v2/us/music/most-played/25/albums.json';

export const itunesRouter = Router();

// GET /api/itunes/search?term=&entity= - iTunes Search API, used as a
// cover-art lookup by artist/album name.
itunesRouter.get('/search', async (req, res) => {
  const term = typeof req.query.term === 'string' ? req.query.term : undefined;
  const entity = typeof req.query.entity === 'string' ? req.query.entity : 'album';
  if (!term) {
    res.status(400).json({ error: 'term is required.' });
    return;
  }
  const url = new URL(ITUNES_SEARCH_URL);
  url.searchParams.set('term', term);
  url.searchParams.set('entity', entity);
  try {
    const upstream = await fetch(url.toString());
    if (!upstream.ok) {
      res.status(502).json({ error: `iTunes Search request failed: ${upstream.status}` });
      return;
    }
    res.json(await upstream.json());
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : 'iTunes Search request failed.' });
  }
});

// GET /api/itunes/new-releases - Apple's Marketing Tools RSS feed's Top
// Albums chart (US), used as the Music tab's "New Releases" row - see
// src/api/itunes.ts's own comment on why this chart, not a literal
// release-date sort (no such chart type exists).
itunesRouter.get('/new-releases', async (_req, res) => {
  try {
    const upstream = await fetch(NEW_RELEASES_URL);
    if (!upstream.ok) {
      res.status(502).json({ error: `Apple Music charts request failed: ${upstream.status}` });
      return;
    }
    res.json(await upstream.json());
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : 'Apple Music charts request failed.' });
  }
});
