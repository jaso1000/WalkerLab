// Node reimplementation of modules/tls-trust's Kotlin native module (Android
// only, irrelevant inside a Docker container) - Portainer's self-signed
// cert's SAN often only covers `localhost`, never the LAN IP anyone
// actually connects by, so hostname verification needs a deliberate,
// narrow bypass exactly when the user has explicitly pinned that cert's
// exact SHA-256 fingerprint. Node's built-in `tls`/`https` modules have full
// TLS socket introspection, so this needs no native addon at all - just a
// careful reimplementation of the same "accept if the chain validates
// normally OR the pinned fingerprint matches; only skip hostname
// verification when the pin match is what accepted it" contract the Kotlin
// module documents.
import crypto from 'crypto';
import https from 'https';
import http from 'http';
import tls from 'tls';
import { URL } from 'url';

export interface TlsCertificateInfo {
  sha256: string;
  subject: string;
  issuer: string;
  notBefore: string;
  notAfter: string;
}

// SHA-256 of the certificate's full DER encoding, colon-separated uppercase
// hex - matches `openssl x509 -noout -fingerprint -sha256` and the Kotlin
// module's own `fingerprint()` exactly, so it's directly spot-checkable.
function fingerprint(der: Buffer): string {
  const hex = crypto.createHash('sha256').update(der).digest('hex').toUpperCase();
  return hex.match(/.{2}/g)!.join(':');
}

// Formats a Node cert subject/issuer object (e.g. `{ CN: 'localhost', O:
// 'Portainer' }`) as a single display string - not byte-identical to Java's
// X500Principal.getName() but conveys the same information for the user to
// review before trusting a cert.
function formatName(name: Record<string, string>): string {
  return Object.entries(name)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
}

// Inspects a server's TLS certificate without validating it, purely so the
// user can review what they'd be trusting before any pin is saved - this
// connection's result is never used for a real request. Returns null both
// on a genuine connection failure and (implicitly) if the host doesn't
// speak TLS at all, matching the native module's same "no cert info means a
// plain connection failure" contract.
export function getCertificateInfo(host: string, port: number): Promise<TlsCertificateInfo | null> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host, port, rejectUnauthorized: false, timeout: 5000 },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert || !cert.raw) {
          resolve(null);
          return;
        }
        resolve({
          sha256: fingerprint(cert.raw),
          subject: formatName(cert.subject as unknown as Record<string, string>),
          issuer: formatName(cert.issuer as unknown as Record<string, string>),
          notBefore: new Date(cert.valid_from).toUTCString(),
          notAfter: new Date(cert.valid_to).toUTCString(),
        });
      }
    );
    socket.on('error', () => resolve(null));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(null);
    });
  });
}

// The real pinned request path: accepts the connection if the certificate
// chain validates normally against the system trust store, OR the leaf
// certificate's SHA-256 fingerprint matches `trustedSha256` - only bypassing
// hostname verification in that second, pin-only case. Exact-fingerprint
// pinning is already a stronger guarantee than hostname-based trust (forging
// it would need the server's actual private key, not just any CA-signed
// cert for that hostname), so this isn't a general weakening.
//
// `rejectUnauthorized: false` stops Node from auto-aborting on a validation
// failure, but Node still populates `socket.authorized`/`authorizationError`
// with what the result *would* have been under normal (chain + hostname)
// validation - checking `authorized || pinMatches` on `secureConnect` and
// destroying the socket otherwise is the direct equivalent of the Kotlin
// module's combined trust-manager + hostname-verifier logic.
export function pinnedFetch(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string },
  trustedSha256: string
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const req = lib.request(
      parsed,
      {
        method: options.method ?? 'GET',
        headers: options.headers,
        // `agent: false` forces a brand-new socket for every single call,
        // never one pooled/reused from Node's default keep-alive agent.
        // This matters for correctness, not just performance: the pin check
        // below only runs on `secureConnect`, which fires once per TLS
        // handshake - a reused socket from an *earlier*, correctly-pinned
        // connection would silently skip re-validation on every later call,
        // including ones passing a since-changed or wrong fingerprint
        // (caught via manual testing: a deliberately-wrong pin still
        // succeeded on a second call because the first call's validated
        // socket was reused instead of a fresh handshake happening).
        agent: false,
        ...(isHttps ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      }
    );
    req.on('error', reject);

    if (isHttps) {
      req.on('socket', (socket) => {
        const tlsSocket = socket as tls.TLSSocket;
        tlsSocket.on('secureConnect', () => {
          const cert = tlsSocket.getPeerCertificate();
          const fp = cert?.raw ? fingerprint(cert.raw) : undefined;
          const pinMatches = !!fp && fp.toLowerCase() === trustedSha256.toLowerCase();
          if (!tlsSocket.authorized && !pinMatches) {
            req.destroy(new Error(`Certificate not trusted (${tlsSocket.authorizationError}).`));
          }
        });
      });
    }

    if (options.body) req.write(options.body);
    req.end();
  });
}
