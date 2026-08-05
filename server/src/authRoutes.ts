import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  authState,
  changeOwnPassword,
  clearSession,
  createUserAccount,
  issueSession,
  requireAdmin,
  requireAuth,
  verifyCredentials,
} from './auth';
import { deleteUserData, getUserById, getUserByUsername, getUsers, hasAnyUsers } from './store';

export const authRouter = Router();

// Login/setup were never rate-limited on the assumption this only ever sat
// on a home LAN - now that it's reachable from the public internet (see
// PLAN.md's cloud-tunnel section), an unlimited login endpoint is a real
// brute-force/DoS surface even with bcrypt's per-attempt cost, since an
// attacker can just run attempts concurrently. Keyed by IP (`trust proxy`
// in index.ts makes `req.ip` reflect the real client through the tunnel,
// not the tunnel's own address).
const authAttemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

authRouter.get('/session', (req, res) => {
  res.json(authState(req));
});

// Only succeeds while no users exist yet at all - re-checked here (not just
// trusted from the client's own "needs-setup" state), so a second browser
// tab racing the wizard can't create two first-admins or silently overwrite
// one. The account created here is always the instance's one admin -
// everyone else comes from the admin-only POST /users below.
authRouter.post('/setup', authAttemptLimiter, async (req, res) => {
  if (hasAnyUsers()) {
    res.status(409).json({ error: 'An admin account already exists.' });
    return;
  }
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'Username is required and password must be at least 8 characters.' });
    return;
  }
  const user = await createUserAccount(username.trim(), password, 'admin');
  issueSession(req, res, user.id);
  res.json({ username: user.username });
});

authRouter.post('/login', authAttemptLimiter, async (req, res) => {
  if (!hasAnyUsers()) {
    res.status(409).json({ error: 'No admin account exists yet.' });
    return;
  }
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Username and password are required.' });
    return;
  }
  const user = await verifyCredentials(username, password);
  if (!user) {
    res.status(401).json({ error: 'Incorrect username or password.' });
    return;
  }
  issueSession(req, res, user.id);
  res.json({ username: user.username });
});

authRouter.post('/logout', (req, res) => {
  clearSession(req, res);
  res.json({ ok: true });
});

// Requires an active session (unlike setup/login above, which by nature
// can't) - this is a sensitive account mutation, so it's gated the same way
// every other authenticated route is, on top of also needing the correct
// current password. Always changes the *calling* user's own password -
// there's no "change someone else's password" endpoint, even for the admin.
authRouter.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 8) {
    res.status(400).json({ error: 'Current password and a new password of at least 8 characters are required.' });
    return;
  }
  const result = await changeOwnPassword(req.userId!, currentPassword, newPassword);
  if (result === 'wrong-password') {
    res.status(401).json({ error: 'Current password is incorrect.' });
    return;
  }
  if (result === 'no-user') {
    res.status(409).json({ error: 'User account no longer exists.' });
    return;
  }
  res.json({ ok: true });
});

// --- Admin-only user management ---------------------------------------------
// The only admin-only surface in the app - creating/removing the other
// accounts that can log into this instance, each with their own
// independent set of Server Profiles. Never returns passwordHash.

authRouter.get('/users', requireAuth, requireAdmin, (_req, res) => {
  res.json(getUsers().map((u) => ({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt })));
});

authRouter.post('/users', requireAuth, requireAdmin, async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'Username is required and password must be at least 8 characters.' });
    return;
  }
  const trimmed = username.trim();
  if (getUserByUsername(trimmed)) {
    res.status(409).json({ error: 'That username is already taken.' });
    return;
  }
  // Always 'user' - the only admin is whoever completed first-run setup;
  // this endpoint has no way to grant that role to anyone else.
  const user = await createUserAccount(trimmed, password, 'user');
  res.json({ id: user.id, username: user.username, role: user.role, createdAt: user.createdAt });
});

authRouter.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
  const target = getUserById(req.params.id);
  if (!target) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }
  if (target.role === 'admin') {
    res.status(400).json({ error: "The admin account can't be deleted." });
    return;
  }
  deleteUserData(req.params.id);
  res.json({ ok: true });
});
