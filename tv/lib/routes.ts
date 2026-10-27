// The phone's routes for a title, as shared helpers return them (wheelItemHref, ...), mapped to the TV
// app's: /movie/<id> -> /movies/<id>, /series/<id> -> /shows/<id>, /artist/<id> -> /music/<id>.
// Discover pages share the same path in both apps.
export function tvRoute(phoneHref: string): string {
  return phoneHref
    .replace(/^\/movie\/(\d+)/, '/movies/$1')
    .replace(/^\/series\/(\d+)/, '/shows/$1')
    .replace(/^\/artist\/(\d+)/, '/music/$1');
}
