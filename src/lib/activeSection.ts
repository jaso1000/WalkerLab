// Whether a section's href should read as "active" for a given pathname -
// Overseerr-style prefix matching (see their Sidebar/MobileMenu components'
// own `activeRegExp` fields) so sub-pages of a section stay highlighted
// (e.g. `/settings/navigation` still highlights Settings, `/tautulli/user/42`
// still highlights Stats, `/discover/category/trending` still highlights
// Discover, and detail pages nested under a section's own href like
// `/containers/[id]` or `/discover/movie/[id]` all fall out of this for
// free). `activePrefixes` (from SECTION_META - see that file's own comment)
// covers the two sections whose detail routes DON'T share a path segment
// with their own href: Movies' href is the plural `/movies` but its detail/
// add routes are the singular `/movie/*`, and TV Shows' href is the root
// `/`, which can only ever be an *exact* match (every path starts with '/',
// so prefix-matching it would make it always active) - its detail routes
// live under `/series/*` instead.
export function isSectionActive(pathname: string, href: string, activePrefixes: string[] = []): boolean {
  const matchesPrefix = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  if (href === '/' ? pathname === '/' : matchesPrefix(href)) return true;
  return activePrefixes.some(matchesPrefix);
}
