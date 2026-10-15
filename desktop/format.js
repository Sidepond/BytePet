export const FORMAT_LIMIT = 1024 * 1024;

// Choose a tool, not a validation result. Each tool still reports its own errors.
export function detectFormat(input) {
  if (input.length > FORMAT_LIMIT || new TextEncoder().encode(input).length > FORMAT_LIMIT) {
    return { format: null, reason: 'limit' };
  }
  const text = input.trim();
  if (!text) return { format: null, reason: 'empty' };
  if (/^Bearer(?:\s|$)/i.test(text)) return { format: 'jwt' };
  if (['{', '[', '"'].includes(text[0]) || /^(?:true|false|null)(?:\s|$)/.test(text)
    || /^-?[0-9][0-9eE+.\-\s]*$/.test(text)) return { format: 'json' };
  const parts = text.split('.');
  if ((parts.length === 3 || parts.length === 5) && /^[A-Za-z0-9_-]+$/.test(parts[0])) {
    try {
      // A JSON object header distinguishes a JWT candidate from filenames/URLs.
      // Allow malformed later segments so the JWT tool can explain the problem.
      const binary = atob(parts[0].replace(/-/g, '+').replace(/_/g, '/'));
      const header = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
      if (header.trimStart().startsWith('{')) return { format: 'jwt' };
    } catch { /* Unrecognized input remains available for manual selection. */ }
  }
  return { format: null, reason: 'unknown' };
}
