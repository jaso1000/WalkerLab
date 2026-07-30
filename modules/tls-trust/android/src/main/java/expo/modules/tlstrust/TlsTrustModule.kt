package expo.modules.tlstrust

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.InetSocketAddress
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.TrustManager
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

// Certificate-pinning support for self-hosted services (e.g. Portainer)
// whose self-signed certificate can't pass Android's normal hostname
// verification - most commonly because the cert only covers `localhost`,
// not whatever LAN IP the server is actually reached by. React Native's
// `fetch()` has no hook into TLS validation at all, so this exists as a
// small native module instead. See PLAN.md's Key decisions entry for the
// full "why" (Android's hostname check is enforced in code, not
// configurable via manifest/XML, and was conclusively proven to be the
// actual blocker via `openssl s_client -verify_hostname` against the real
// server before any of this was written).

// SHA-256 fingerprint of a certificate's full DER encoding, formatted the
// same way `openssl x509 -noout -fingerprint -sha256` prints it
// (colon-separated uppercase hex) so it's directly comparable/spot-
// checkable against that command's output.
private fun fingerprint(cert: X509Certificate): String =
  MessageDigest.getInstance("SHA-256").digest(cert.encoded).joinToString(":") { "%02X".format(it) }

private fun systemTrustManager(): X509TrustManager {
  val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
  factory.init(null as KeyStore?)
  return factory.trustManagers.filterIsInstance<X509TrustManager>().first()
}

class TlsTrustModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TlsTrust")

    // Connects with a permissive trust manager purely to read what
    // certificate the server presents, so the user can review it (subject/
    // issuer/fingerprint/validity) before any pin is saved - this
    // connection's result is never used for a real request. Returns null
    // if the host can't even be reached, so the caller can tell "server is
    // down" apart from "server is up but its cert is rejected" - a plain
    // network-down case should still look like one, not a spurious cert
    // prompt.
    AsyncFunction("getCertificateInfo") { host: String, port: Int ->
      try {
        val trustAll = arrayOf<TrustManager>(object : X509TrustManager {
          override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}
          override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {}
          override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
        })
        val context = SSLContext.getInstance("TLS")
        context.init(null, trustAll, SecureRandom())
        val socket = context.socketFactory.createSocket() as SSLSocket
        socket.connect(InetSocketAddress(host, port), 5000)
        socket.soTimeout = 5000
        socket.startHandshake()
        val cert = socket.session.peerCertificates[0] as X509Certificate
        socket.close()
        return@AsyncFunction mapOf(
          "sha256" to fingerprint(cert),
          "subject" to cert.subjectX500Principal.name,
          "issuer" to cert.issuerX500Principal.name,
          "notBefore" to cert.notBefore.toString(),
          "notAfter" to cert.notAfter.toString()
        )
      } catch (e: Exception) {
        return@AsyncFunction null
      }
    }

    // The real pinned request path: accepts the connection if the
    // certificate chain validates normally against the system trust store,
    // OR the leaf certificate's SHA-256 fingerprint matches
    // `trustedSha256` - and only bypasses hostname verification in that
    // second, pin-only case. Exact-fingerprint pinning is already a
    // stronger guarantee than hostname-based trust (forging it would need
    // the server's actual private key, not just any CA-signed cert for
    // that hostname), so this isn't a general weakening - every other
    // connection still goes through normal validation.
    AsyncFunction("fetch") { url: String, method: String, headers: Map<String, String>, body: String?, trustedSha256: String ->
      var pinnedMatchUsed = false
      val systemTrust = systemTrustManager()

      val trustManager = object : X509TrustManager {
        override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {
          systemTrust.checkClientTrusted(chain, authType)
        }

        override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
          if (chain.isNotEmpty() && fingerprint(chain[0]).equals(trustedSha256, ignoreCase = true)) {
            pinnedMatchUsed = true
            return
          }
          systemTrust.checkServerTrusted(chain, authType)
        }

        override fun getAcceptedIssuers(): Array<X509Certificate> = systemTrust.acceptedIssuers
      }

      val hostnameVerifier = HostnameVerifier { hostname, session ->
        pinnedMatchUsed || HttpsURLConnection.getDefaultHostnameVerifier().verify(hostname, session)
      }

      val sslContext = SSLContext.getInstance("TLS")
      sslContext.init(null, arrayOf<TrustManager>(trustManager), SecureRandom())

      val client = OkHttpClient.Builder()
        .sslSocketFactory(sslContext.socketFactory, trustManager)
        .hostnameVerifier(hostnameVerifier)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

      // OkHttp requires a non-null body for methods like POST/PUT/PATCH
      // even when there's nothing to send (Portainer's container actions
      // are POSTs with no JSON body), so an empty body is substituted
      // rather than passing null for those methods.
      val requestBody = when {
        body != null -> body.toRequestBody("application/json".toMediaTypeOrNull())
        method in listOf("POST", "PUT", "PATCH") -> "".toRequestBody(null)
        else -> null
      }

      val requestBuilder = Request.Builder().url(url).method(method, requestBody)
      headers.forEach { (key, value) -> requestBuilder.addHeader(key, value) }

      client.newCall(requestBuilder.build()).execute().use { response ->
        return@AsyncFunction mapOf(
          "status" to response.code,
          "body" to (response.body?.string() ?: "")
        )
      }
    }
  }
}
