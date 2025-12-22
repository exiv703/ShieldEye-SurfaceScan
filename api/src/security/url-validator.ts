import dns from 'dns';
import net from 'net';

export async function validateTargetUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error('Unsupported URL protocol');
  }

  const hostname = parsed.hostname.toLowerCase();
  // Quick block for obvious local hosts
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    throw new Error('Access to local addresses is not allowed');
  }

  const isPrivateIp = (ip: string): boolean => {
    const kind = net.isIP(ip);
    if (kind === 4) {
      const octets = ip.split('.').map((x) => parseInt(x, 10));
      if (octets.length !== 4 || octets.some((n) => Number.isNaN(n))) return false;
      const [o1, o2] = octets;
      if (o1 === 10) return true; // 10.0.0.0/8
      if (o1 === 127) return true; // 127.0.0.0/8 loopback
      if (o1 === 169 && o2 === 254) return true; // 169.254.0.0/16 link-local
      if (o1 === 192 && o2 === 168) return true; // 192.168.0.0/16
      if (o1 === 172 && o2 >= 16 && o2 <= 31) return true; // 172.16.0.0/12
      return false;
    }
    if (kind === 6) {
      const lower = ip.toLowerCase();
      if (lower === '::1') return true; // loopback
      // Unique local addresses fc00::/7 and link-local fe80::/10
      if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
      if (lower.startsWith('fe80')) return true;
      return false;
    }
    return false;
  };

  try {
    const records = await dns.promises.lookup(hostname, { all: true });
    for (const rec of records) {
      if (isPrivateIp(rec.address)) {
        throw new Error('Access to private or internal network addresses is not allowed');
      }
    }
  } catch (err: any) {
    if (err instanceof Error && /private or internal network/.test(err.message)) {
      throw err;
    }
    if (err && (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN')) {
      throw new Error(`Failed to resolve target host: ${hostname}`);
    }
    throw new Error('Failed to validate target URL');
  }

  return parsed;
}

