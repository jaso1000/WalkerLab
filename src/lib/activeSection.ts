// Whether a section's href should read as "active" for a given pathname -
// Overseerr-style prefix matching (see their Sidebar/MobileMenu components'
// own `activeRegExp` fields) so sub-pages of a section stay highlighted
// (e.g. `/settings/navigation` still highlights Settings, `/tautulli/user/42`
// still highlights Stats, `/discover/category/trending` still highlights
// Discover) while genuinely separate detail routes that don't share the
// section's own path segment (`/movie/[id]`, `/series/[id]`, `/stacks/[id]`)
// correctly show no active section at all - matching Overseerr's own
// behavior of not highlighting anything while viewing a movie/show detail
// page. This falls out naturally from this app's existing route naming
// (the Movies section's href is the plural `/movies`, while its detail/add
// routes are the singular `/movie/*`) rather than needing a lookup table.
//
// The root section (href '/') is the one special case: every path starts
// with '/', so it needs an exact match instead of a prefix match, or it
// would always read as active regardless of the real current screen.
export function isSectionActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
