// Multi-user auth: first-run setup detection, password hashing/verification,
// and a signed-cookie session (an opaque random token looked up against a
// session table persisted in the store, not a JWT - this app has at most a
// handful of concurrent users/sessions, so a real server-side record that
// supports instant, real revocation on logout (or on an admin deleting a
// user - see store.ts's deleteUserData) matters more here than JWT's
// stateless-scaling advantage). One admin per instance (whoever completes
// first-run setup); the admin can create additional plain-user accounts
// from Settings, each with their own independent set of Server Profiles.
import { NextFunction, Request, Response } from 'express';
import { hashPassword, randomToken, verifyPassword } from './crypto';
import {
  createSession,
  createUser,
  deleteOtherSessions,
  deleteSession,
  getUserById,
  getUserByUsername,
  hasAnyUsers,
  findSessionIdByImageToken,
  touchSession,
  updateUser,
} from './store';
import { isSafeId, newUserId, UserRecord } from './types';

// Augments Express's own Request type so requireAuth can attach the
// authenticated user's id/role for every downstream route handler to read,
// without every route re-deriving it from the session cookie itself.
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userRole?: 'admin' | 'user';
    }
  }
}

export const SESSION_COOKIE = 'walkerlab_session';
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // rolling 30 days

export type AuthState =
  | { state: 'needs-setup' }
  | { state: 'needs-login' }
  | { state: 'authenticated'; username: string; role: 'admin' | 'user' };

function isSecureRequest(req: Request): boolean {
  // Behind a TLS-terminating reverse proxy/tunnel, the connection to this
  // process itself is often plain HTTP - `X-Forwarded-Proto` is how the
  // proxy tells us the original scheme was https. `req.secure` already reads
  // that header, but only from proxies the `trust proxy` setting
  // (index.ts, WALKERLAB_TRUST_PROXY) says to believe.
  return req.secure;
}

// Resolves the request's session all the way to a real user record, or
// undefined if there's no credential, an expired/unknown session, or
// (should never happen in practice - deleteUserData also purges a deleted
// user's sessions) a session whose user no longer exists. Checks the
// session cookie first (browsers), falling back to an `Authorization:
// Bearer <sessionId>` header (the native app - it has no browser cookie
// jar to persist an httpOnly cookie across restarts, so it stores the raw
// session id itself instead, returned in the login response body
// specifically for this - see issueSession below). Same session store
// either way, just two ways to present the same token. An explicit Bearer
// header wins over a cookie: browsers never send one, and React Native's
// networking layer keeps its own cookie jar, which could otherwise replay a
// stale cookie from an earlier login over the session the app chose.
function requestSessionId(req: Request): string | undefined {
  const bearerMatch = req.get('authorization')?.match(/^Bearer (.+)$/);
  return bearerMatch?.[1] ?? req.cookies?.[SESSION_COOKIE];
}

function userForSession(sessionId: string): UserRecord | undefined {
  const session = touchSession(sessionId, SESSION_DURATION_MS);
  if (!session) return undefined;
  return getUserById(session.userId);
}

function getAuthenticatedUser(req: Request): UserRecord | undefined {
  const sessionId = requestSessionId(req);
  if (!sessionId) return undefined;
  return userForSession(sessionId);
}

export function authState(req: Request): AuthState {
  if (!hasAnyUsers()) return { state: 'needs-setup' };
  const user = getAuthenticatedUser(req);
  if (!user) return { state: 'needs-login' };
  return { state: 'authenticated', username: user.username, role: user.role };
}

// Returns the raw session id in addition to setting the cookie - a browser
// client never needs it (the httpOnly cookie handles everything for it
// automatically), but the native app's login screen does, to store it
// itself and replay it as a Bearer header (see getAuthenticatedUser above).
// Putting it in the response body doesn't weaken the cookie's httpOnly
// protection for browsers - that guards against a *different* script
// reading `document.cookie`, not the page's own fetch call reading its own
// response.
export function issueSession(req: Request, res: Response, userId: string): string {
  const sessionId = randomToken();
  createSession(sessionId, userId, new Date(Date.now() + SESSION_DURATION_MS));
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req),
    maxAge: SESSION_DURATION_MS,
    path: '/',
  });
  return sessionId;
}

export function clearSession(req: Request, res: Response) {
  // Same cookie-or-Bearer fallback as getAuthenticatedUser above, so a
  // native client's "disconnect" actually invalidates its session id
  // server-side too, not just locally.
  const sessionId = requestSessionId(req);
  if (sessionId) deleteSession(sessionId);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function createUserAccount(username: string, password: string, role: 'admin' | 'user'): Promise<UserRecord> {
  const passwordHash = await hashPassword(password);
  const user: UserRecord = { id: newUserId(), username, passwordHash, role, createdAt: new Date().toISOString() };
  createUser(user);
  return user;
}

// A fixed dummy hash, computed once at startup - see verifyCredentials for
// why a login attempt against a genuinely unknown username still needs a
// real bcrypt compare to run against *something*.
const DUMMY_HASH_PROMISE = hashPassword('walkerlab-dummy-password-for-constant-time-login');

// Always runs the (slow, constant-time-ish) bcrypt compare regardless of
// whether the username matches a real account, rather than short-circuiting
// on an unknown username - short-circuiting would make wrong-username
// attempts return measurably faster than wrong-password ones, a timing
// side-channel that lets a remote attacker enumerate real usernames. Single-
// admin builds of this app closed this by always comparing against the one
// real admin hash even on a username mismatch; multi-user needs a dummy
// hash as the fallback for a username that doesn't exist at all.
export async function verifyCredentials(username: string, password: string): Promise<UserRecord | undefined> {
  const user = getUserByUsername(username);
  const hashToCheck = user?.passwordHash ?? (await DUMMY_HASH_PROMISE);
  const passwordValid = await verifyPassword(password, hashToCheck);
  return user && passwordValid ? user : undefined;
}

// Changes the calling user's own password in place - requires the correct
// *current* password first, same as any account settings page. Every OTHER
// session for this user is revoked (a password change is usually a response
// to "someone else might have access"); the session making the change is
// kept so the person doing it isn't logged out mid-flow.
export type ChangePasswordResult = 'ok' | 'wrong-password' | 'no-user';

export async function changeOwnPassword(req: Request, userId: string, currentPassword: string, newPassword: string): Promise<ChangePasswordResult> {
  const user = getUserById(userId);
  if (!user) return 'no-user';
  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) return 'wrong-password';
  const passwordHash = await hashPassword(newPassword);
  updateUser(userId, { passwordHash });
  deleteOtherSessions(userId, requestSessionId(req));
  return 'ok';
}

// Only seeds an admin when no users exist yet at all - never overwrites an
// existing password from an env var (a stale/committed .env with an old
// password should never silently lock out a user who's since changed it in
// the UI).
export async function seedAdminFromEnvIfAbsent() {
  if (hasAnyUsers()) return;
  const username = process.env.WALKERLAB_ADMIN_USERNAME;
  const password = process.env.WALKERLAB_ADMIN_PASSWORD;
  if (!username || !password) return;
  await createUserAccount(username, password, 'admin');
  console.log(`[auth] Seeded admin account "${username}" from environment variables.`);
}

// The only 401 that means "your session is gone" - the WWW-Authenticate header
// is how the native app (src/lib/backendApi.ts) tells it apart from other
// 401s like change-password's wrong-current-password, so it only drops back
// to its login form for a real session failure.
function rejectUnauthenticated(res: Response) {
  res.set('WWW-Authenticate', 'Bearer');
  res.status(401).json({ error: 'Not authenticated.' });
}

// Express middleware for every /api/config, /api/proxy, /api/image-proxy
// route - rejects with 401 unless a valid session cookie is present, and
// attaches the authenticated user's id/role for every downstream handler.
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = getAuthenticatedUser(req);
  if (!user) {
    rejectUnauthenticated(res);
    return;
  }
  req.userId = user.id;
  req.userRole = user.role;
  next();
}

// The image proxy only (/api/image-proxy): a normal session (cookie/Bearer),
// or the native app's image token in `?token=` - see store.ts's
// imageTokenForSession for why images get their own, narrower credential.
// The token is removed from req.query so it's never forwarded upstream.
export function requireImageAuth(req: Request, res: Response, next: NextFunction) {
  let user = getAuthenticatedUser(req);
  const token = req.query.token;
  if (!user && typeof token === 'string' && token) {
    const sessionId = findSessionIdByImageToken(token);
    if (sessionId) user = userForSession(sessionId);
  }
  delete req.query.token;
  if (!user) {
    rejectUnauthenticated(res);
    return;
  }
  req.userId = user.id;
  req.userRole = user.role;
  next();
}

// `router.param()` handler for every `:profileId`/`:userId` URL param - see
// types.ts's isSafeId for why (prototype pollution through store.ts's maps).
// 404 rather than 400 so an unknown/odd id looks the same as a missing one.
export function validateIdParam(_req: Request, res: Response, next: NextFunction, value: unknown) {
  if (!isSafeId(value)) {
    res.status(404).json({ error: 'Not found.' });
    return;
  }
  next();
}

// Chains after requireAuth on the user-management routes (create/list/
// delete other users) - those are the only admin-only surface in the app.
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.userRole !== 'admin') {
    res.status(403).json({ error: 'Admin access required.' });
    return;
  }
  next();
}
