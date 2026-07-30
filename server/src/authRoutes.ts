import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authState, changeAdminPassword, clearSession, createAdmin, issueSession, requireAuth, verifyAdminCredentials } from './auth';
import { getAdmin } from './store';

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

// Only succeeds while no admin exists yet - re-checked here (not just
// trusted from the client's own "needs-setup" state), so a second browser
// tab racing the wizard can't create two admins or silently overwrite one.
authRouter.post('/setup', authAttemptLimiter, async (req, res) => {
  if (getAdmin()) {
    res.status(409).json({ error: 'An admin account already exists.' });
    return;
  }
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'Username is required and password must be at least 8 characters.' });
    return;
  }
  await createAdmin(username.trim(), password);
  issueSession(req, res);
  res.json({ username: username.trim() });
});

authRouter.post('/login', authAttemptLimiter, async (req, res) => {
  if (!getAdmin()) {
    res.status(409).json({ error: 'No admin account exists yet.' });
    return;
  }
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Username and password are required.' });
    return;
  }
  const ok = await verifyAdminCredentials(username, password);
  if (!ok) {
    res.status(401).json({ error: 'Incorrect username or password.' });
    return;
  }
  issueSession(req, res);
  res.json({ username });
});

authRouter.post('/logout', (req, res) => {
  clearSession(req, res);
  res.json({ ok: true });
});

// Requires an active session (unlike setup/login above, which by nature
// can't) - this is a sensitive account mutation, so it's gated the same way
// every other authenticated route is, on top of also needing the correct
// current password.
authRouter.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 8) {
    res.status(400).json({ error: 'Current password and a new password of at least 8 characters are required.' });
    return;
  }
  const result = await changeAdminPassword(currentPassword, newPassword);
  if (result === 'wrong-password') {
    res.status(401).json({ error: 'Current password is incorrect.' });
    return;
  }
  if (result === 'no-admin') {
    res.status(409).json({ error: 'No admin account exists yet.' });
    return;
  }
  res.json({ ok: true });
});
