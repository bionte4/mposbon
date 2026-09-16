/**
 * Strict CORS allowlist for the decoupled SPA ↔ API architecture.
 * Only origins listed in FRONTEND_URL + CORS_ORIGINS are accepted.
 * Trailing slashes are normalized; unknown browser Origins are rejected.
 */

export function normalizeOrigin(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

export function parseCorsAllowlist(
  frontendUrl: string,
  corsOriginsCsv: string,
): string[] {
  const origins = [
    frontendUrl,
    ...corsOriginsCsv.split(',').map((o) => o.trim()).filter(Boolean),
  ]
    .map(normalizeOrigin)
    .filter(Boolean);

  return [...new Set(origins)];
}

/**
 * Nest/Express CORS `origin` callback.
 * - No Origin (curl, server-to-server, same-origin non-CORS): allowed
 * - Browser Origin must match the allowlist exactly
 */
export function createCorsOriginDelegate(allowlist: string[]) {
  const allowed = new Set(allowlist.map(normalizeOrigin));

  return (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ): void => {
    if (!origin) {
      callback(null, true);
      return;
    }

    const normalized = normalizeOrigin(origin);
    if (allowed.has(normalized)) {
      callback(null, true);
      return;
    }

    callback(new Error(`CORS origin not allowed: ${origin}`), false);
  };
}
