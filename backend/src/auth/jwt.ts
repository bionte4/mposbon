/**
 * Minimal HS256 JWT (no external deps). Payload is JSON; exp is unix seconds.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type JwtPayload = {
  sub: string;
  tenantId: string;
  email: string;
  role: string;
  exp: number;
  iat: number;
};

function b64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function b64urlJson(value: unknown): string {
  return b64url(JSON.stringify(value));
}

export function jwtSecret(): string {
  return process.env.JWT_SECRET || process.env.AUTH_SECRET || 'bonpos-dev-jwt-secret-change-me';
}

export function signAccessToken(
  claims: Omit<JwtPayload, 'exp' | 'iat'>,
  expiresInSec = 60 * 60 * 12,
): string {
  const iat = Math.floor(Date.now() / 1000);
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const body = b64urlJson({ ...claims, iat, exp: iat + expiresInSec });
  const sig = createHmac('sha256', jwtSecret())
    .update(`${header}.${body}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${header}.${body}.${sig}`;
}

export function verifyAccessToken(token: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed token');
  }
  const [header, body, sig] = parts;
  const expected = createHmac('sha256', jwtSecret())
    .update(`${header}.${body}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('Invalid token signature');
  }
  const payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()) as JwtPayload;
  if (!payload.sub || !payload.tenantId || !payload.exp) {
    throw new Error('Invalid token payload');
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }
  return payload;
}
