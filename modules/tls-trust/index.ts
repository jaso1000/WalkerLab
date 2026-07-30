// Certificate-pinning support for self-hosted services whose self-signed
// certificate can't pass Android's normal hostname verification (see
// PLAN.md's Key decisions entry for the full "why" and the native module
// itself for the pinning mechanism). Android-only - iOS/web builds get a
// null native module, so every export here degrades to "not available"
// rather than crashing, and callers (see the Portainer cert-trust flow in
// app/settings/[service].tsx) already treat a null/thrown result the same
// as any other connection failure.
import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import { apiFetch } from '../../src/lib/backendApi';

export interface TlsCertificateInfo {
  sha256: string;
  subject: string;
  issuer: string;
  notBefore: string;
  notAfter: string;
}

interface NativeTlsTrustModule {
  getCertificateInfo(host: string, port: number): Promise<TlsCertificateInfo | null>;
  fetch(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string | null,
    trustedSha256: string
  ): Promise<{ status: number; body: string }>;
}

const NativeTlsTrust: NativeTlsTrustModule | null =
  Platform.OS === 'android' ? requireNativeModule<NativeTlsTrustModule>('TlsTrust') : null;

// Inspects a server's TLS certificate without validating it, purely so the
// user can review what they'd be trusting before any pin is saved. Returns
// null both when the platform doesn't support this (iOS) and when the host
// genuinely can't be reached - callers already have to handle "no cert info
// available" as a plain connection failure either way. On web, this is
// backed by the Node backend's own `tls`-based equivalent (see
// server/src/services/portainerTls.ts) rather than a native module - the
// backend can reach the host directly (same LAN as the media-server stack),
// which a browser generally can't.
export async function getCertificateInfo(host: string, port: number): Promise<TlsCertificateInfo | null> {
  if (Platform.OS === 'web') {
    return apiFetch<TlsCertificateInfo | null>(`/api/tls/certificate-info?host=${encodeURIComponent(host)}&port=${port}`);
  }
  if (!NativeTlsTrust) return null;
  return NativeTlsTrust.getCertificateInfo(host, port);
}

// Pinned fetch: accepts the connection if the server's certificate chain
// validates normally, or its exact SHA-256 fingerprint matches
// `trustedSha256` - see the native module for why bypassing hostname
// verification is safe only in that second, pin-matched case.
export async function pinnedFetch(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string },
  trustedSha256: string
): Promise<{ status: number; body: string }> {
  if (!NativeTlsTrust) throw new Error('Certificate pinning is only available on Android.');
  return NativeTlsTrust.fetch(url, options.method ?? 'GET', options.headers ?? {}, options.body ?? null, trustedSha256);
}
