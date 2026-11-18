/**
 * Browser security headers for every response: the API, the built site when it is
 * served by `npm start`, and `vite preview`. vercel.json repeats the production set
 * for Vercel's own static hosting; tests/api/security-headers.test.ts keeps them identical.
 *
 * The browser talks to Supabase directly (realtime, signed uploads, CV previews,
 * recordings), so its origin is allowed for those. Everything else stays on this site.
 * Self-hosting with a custom Supabase domain: add it next to SUPABASE below.
 */
const SUPABASE = 'https://*.supabase.co';

/** `https`: only over TLS do HSTS and upgrading every request make sense; on http://localhost they break the page. */
export function contentSecurityPolicy(https: boolean): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    // React sets style attributes; the CSS itself is all bundled.
    "style-src 'self' 'unsafe-inline'",
    // Avatars and recordings come from signed storage URLs; a company logo may be any https image.
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${SUPABASE} wss://*.supabase.co`,
    `media-src 'self' blob: ${SUPABASE}`,
    `frame-src 'self' blob: ${SUPABASE}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Other sites may not put this app in a frame (clickjacking).
    "frame-ancestors 'self'",
    ...(https ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

export function securityHeaders(https: boolean): Record<string, string> {
  return {
    'Content-Security-Policy': contentSecurityPolicy(https),
    'X-Frame-Options': 'SAMEORIGIN',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(self), microphone=(self), display-capture=(self)',
    'Cross-Origin-Opener-Policy': 'same-origin',
    ...(https ? { 'Strict-Transport-Security': 'max-age=63072000; includeSubDomains' } : {}),
  };
}
