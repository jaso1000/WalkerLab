// GET /api/tls/certificate-info?host=&port= - backs the web build's version
// of the Portainer "Certificate Not Trusted" consent dialog (see
// app/settings/[service].tsx's `tryOfferCertTrust`), which on Android calls
// the native tls-trust module directly. Not profile-scoped: this just
// probes an arbitrary host/port the client already parsed out of the typed
// (not-yet-saved) baseUrl field, purely to show the user what they'd be
// trusting - it never establishes trust itself.
import { Router } from 'express';
import { getCertificateInfo } from './services/portainerTls';

export const tlsRouter = Router();

tlsRouter.get('/certificate-info', async (req, res) => {
  const host = typeof req.query.host === 'string' ? req.query.host : undefined;
  const port = Number(req.query.port);
  if (!host || !Number.isFinite(port)) {
    res.status(400).json({ error: 'host and port are required.' });
    return;
  }
  const info = await getCertificateInfo(host, port);
  res.json(info);
});
