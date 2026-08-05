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
  deleteSession,
  getUserById,
  getUserByUsername,
  hasAnyUsers,
  touchSession,
  updateUser,
} from './store';
import { newUserId, UserRecord } from './types';

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
  // proxy tells us the original scheme was https. `req.secure` alone would
  // otherwise report false and the cookie would never get `Secure` set.
  return req.secure || req.get('x-forwarded-proto') === 'https';
}

// Resolves the request's session cookie all the way to a real user record,
// or undefined if there's no cookie, an expired/unknown session, or (should
// never happen in practice - deleteUserData also purges a deleted user's
// sessions) a session whose user no longer exists.
function getAuthenticatedUser(req: Request): UserRecord | undefined {
  const sessionId = req.cookies?.[SESSION_COOKIE];
  if (!sessionId) return undefined;
  const session = touchSession(sessionId, SESSION_DURATION_MS);
  if (!session) return undefined;
  return getUserById(session.userId);
}

export function authState(req: Request): AuthState {
  if (!hasAnyUsers()) return { state: 'needs-setup' };
  const user = getAuthenticatedUser(req);
  if (!user) return { state: 'needs-login' };
  return { state: 'authenticated', username: user.username, role: user.role };
}

export function issueSession(req: Request, res: Response, userId: string) {
  const sessionId = randomToken();
  createSession(sessionId, userId, new Date(Date.now() + SESSION_DURATION_MS));
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req),
    maxAge: SESSION_DURATION_MS,
    path: '/',
  });
}

export function clearSession(req: Request, res: Response) {
  const sessionId = req.cookies?.[SESSION_COOKIE];
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
// *current* password first, same as any account settings page. Doesn't
// touch other sessions (including this one) - a password change only
// affects future logins, matching the common pattern of not forcing an
// immediate re-login in your own already-authenticated session.
export type ChangePasswordResult = 'ok' | 'wrong-password' | 'no-user';

export async function changeOwnPassword(userId: string, currentPassword: string, newPassword: string): Promise<ChangePasswordResult> {
  const user = getUserById(userId);
  if (!user) return 'no-user';
  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) return 'wrong-password';
  const passwordHash = await hashPassword(newPassword);
  updateUser(userId, { passwordHash });
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

// Express middleware for every /api/config, /api/proxy, /api/image-proxy
// route - rejects with 401 unless a valid session cookie is present, and
// attaches the authenticated user's id/role for every downstream handler.
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not authenticated.' });
    return;
  }
  req.userId = user.id;
  req.userRole = user.role;
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
