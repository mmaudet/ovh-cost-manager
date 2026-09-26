/**
 * Reading a host header, Host or X-Forwarded-Host, for the CORS check and the
 * Host check, so that both read a header the same way.
 */

// The loopback names, compared with the whole hostname, as URL writes it
const LOOPBACK_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'];

// What a host header may hold: a name, an IPv4 address or an IPv6 one in
// brackets, then a port. URL would read a path, a user or a query after a
// host, or a tab within it, as that host alone.
const HOST_CHARACTERS = /^[\w.:[\]-]+$/;

// The first value of a header that may hold a list, as Express reads it
function firstValue(header) {
  return header.split(',')[0].trim();
}

/**
 * A host header as URL writes it: lowercase, and without the default port of
 * the request's scheme, or of both http and https when the scheme is not
 * known. Behind a TLS-terminating proxy, the connection is plain HTTP whatever
 * the page's scheme.
 *
 * @param {string|undefined} header - a Host or X-Forwarded-Host value
 * @param {string} [protocol] - 'http:' or 'https:', when known
 * @returns {{host: string, hostname: string}|null} the host, and its name
 *   without the port; null when the header is no host
 */
function parseHost(header, protocol) {
  if (!header || !HOST_CHARACTERS.test(header)) {
    return null;
  }
  let url;
  try {
    url = new URL(`${protocol || 'http:'}//${header}`);
  } catch (e) {
    return null;
  }
  // URL drops the default port of the scheme it parsed with, 80 without one
  const host = !protocol && url.port === '443' ? url.hostname : url.host;
  return { host, hostname: url.hostname };
}

module.exports = { LOOPBACK_HOSTNAMES, firstValue, parseHost };
