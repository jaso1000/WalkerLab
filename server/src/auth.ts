// Single-admin auth: first-run setup detection, password hashing/verification,
// and a signed-cookie session (an opaque random token looked up against a
// session table persisted in the store, not a JWT - this is a single-admin
// app with at most a handful of concurrent sessions, so a real server-side
// record that supports instant, real revocation on logout matters more here
// than JWT's stateless-scaling advantage).
import { NextFunction, Request, Response } from 'express';
import { hashPassword, randomToken, verifyPassword } from './crypto';
import { createSession, deleteSession, getAdmin, setAdmin, touchSession } from './store';

export const SESSION_COOKIE = 'walkerlab_session';
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // rolling 30 days

export type AuthState = { state: 'needs-setup' } | { state: 'needs-login' } | { state: 'authenticated'; username: string };

function isSecureRequest(req: Request): boolean {
  // Behind a TLS-terminating reverse proxy/tunnel, the connection to this
  // process itself is often plain HTTP - `X-Forwarded-Proto` is how the
  // proxy tells us the original scheme was https. `req.secure` alone would
  // otherwise report false and the cookie would never get `Secure` set.
  return req.secure || req.get('x-forwarded-proto') === 'https';
}

export function authState(req: Request): AuthState {
  const admin = getAdmin();
  if (!admin) return { state: 'needs-setup' };
  const sessionId = req.cookies?.[SESSION_COOKIE];
  if (sessionId && touchSession(sessionId, SESSION_DURATION_MS)) {
    return { state: 'authenticated', username: admin.username };
  }
  return { state: 'needs-login' };
}

export function issueSession(req: Request, res: Response) {
  const sessionId = randomToken();
  createSession(sessionId, new Date(Date.now() + SESSION_DURATION_MS));
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

export async function createAdmin(username: string, password: string) {
  const passwordHash = await hashPassword(password);
  setAdmin({ username, passwordHash, createdAt: new Date().toISOString() });
}

export async function verifyAdminCredentials(username: string, password: string): Promise<boolean> {
  const admin = getAdmin();
  if (!admin) return false;
  // Always run the (slow, constant-time-ish) bcrypt compare regardless of
  // whether the username matches, rather than short-circuiting on a bad
  // username - short-circuiting made wrong-username attempts return
  // measurably faster than wrong-password ones, a timing side-channel that
  // let a remote attacker enumerate the admin username. Low-stakes on a
  // single-admin app, but free to close now that login is reachable from
  // the public internet.
  const passwordValid = await verifyPassword(password, admin.passwordHash);
  return admin.username === username && passwordValid;
}

// Changes the admin's password in place (keeps the same username/createdAt) -
// requires the correct *current* password first, same as any account
// settings page. Doesn't touch other sessions (including this one) - a
// password change only affects future logins, matching the common pattern
// of not forcing an immediate re-login in your own already-authenticated
// session.
export type ChangePasswordResult = 'ok' | 'wrong-password' | 'no-admin';

export async function changeAdminPassword(currentPassword: string, newPassword: string): Promise<ChangePasswordResult> {
  const admin = getAdmin();
  if (!admin) return 'no-admin';
  const valid = await verifyPassword(currentPassword, admin.passwordHash);
  if (!valid) return 'wrong-password';
  const passwordHash = await hashPassword(newPassword);
  setAdmin({ ...admin, passwordHash });
  return 'ok';
}

// Only seeds an admin when none exists yet - never overwrites an existing
// password from an env var (a stale/committed .env with an old password
// should never silently lock out a user who's since changed it in the UI).
export async function seedAdminFromEnvIfAbsent() {
  if (getAdmin()) return;
  const username = process.env.WALKERLAB_ADMIN_USERNAME;
  const password = process.env.WALKERLAB_ADMIN_PASSWORD;
  if (!username || !password) return;
  await createAdmin(username, password);
  console.log(`[auth] Seeded admin account "${username}" from environment variables.`);
}

// Express middleware for every /api/config and /api/proxy route - rejects
// with 401 unless a valid session cookie is present.
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const state = authState(req);
  if (state.state !== 'authenticated') {
    res.status(401).json({ error: 'Not authenticated.' });
    return;
  }
  next();
}
