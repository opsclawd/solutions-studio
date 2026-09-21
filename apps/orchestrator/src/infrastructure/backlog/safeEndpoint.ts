import net from 'node:net';
import { RealBacklogMutationForbiddenError } from '../../application/ports/backlog/BacklogExportErrors.js';

/**
 * Validates whether a given URL string points strictly to a loopback address.
 *
 * Rules:
 * - Must be a valid URL parseable by `new URL()`
 * - Protocol must be strictly 'http:' or 'https:'
 * - Must NOT contain credentials/userinfo (username or password)
 * - Hostname must be normalized (lowercased, brackets removed for IPv6)
 * - Must match:
 *   - 'localhost'
 *   - IPv4 loopback (127.0.0.0/8, i.e. 127.x.x.x)
 *   - IPv6 loopback (::1, [::1], 0:0:0:0:0:0:0:1)
 * - Deceptive suffixes (e.g. localhost.attacker.example, 127.0.0.1.attacker.example) are rejected.
 */
export function isLoopbackEndpoint(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    // Reject userinfo/credentials
    if (parsed.username || parsed.password) {
      return false;
    }

    let hostname = parsed.hostname.toLowerCase();

    // Strip IPv6 square brackets if present
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      hostname = hostname.slice(1, -1);
    }

    // Check exact 'localhost'
    if (hostname === 'localhost') {
      return true;
    }

    // Check IPv4 loopback: 127.0.0.0/8
    if (net.isIPv4(hostname)) {
      const octets = hostname.split('.').map((part) => parseInt(part, 10));
      if (
        octets.length === 4 &&
        octets[0] === 127 &&
        octets.every((o) => !isNaN(o) && o >= 0 && o <= 255)
      ) {
        return true;
      }
    }

    // Check IPv6 loopback: ::1
    if (net.isIPv6(hostname)) {
      if (hostname === '::1' || hostname === '0:0:0:0:0:0:0:1') {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Asserts that the endpoint is safe to mutate without explicit operator permission.
 * Throws RealBacklogMutationForbiddenError if non-loopback and allowRealMutation is false.
 */
export function assertSafeBacklogEndpoint(urlString: string, allowRealMutation: boolean): void {
  const isSafe = isLoopbackEndpoint(urlString);
  if (!isSafe && !allowRealMutation) {
    throw new RealBacklogMutationForbiddenError(
      `Real external backlog mutation to '${urlString}' is forbidden without explicit operator authorization (ALLOW_REAL_BACKLOG_MUTATION=true or --allow-real-mutation)`
    );
  }
}
