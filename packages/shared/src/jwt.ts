import jwt, { JwtPayload } from 'jsonwebtoken';

/**
 * RS256 everywhere. Only the Auth Gateway holds the private key (signs);
 * Txn Service and Read Service verify with the public key alone — they can
 * never mint a token. See scripts/generate-keys for how the keypair is made.
 */
export interface AccessTokenClaims {
  sub: number; // user id
  tv: number; // auth.users.token_version at issuance — a mismatch means "logout-all" fired
  role: 'USER' | 'ADMIN';
}

export function signAccessToken(privateKeyPem: string, claims: AccessTokenClaims): string {
  return jwt.sign(claims, privateKeyPem, { algorithm: 'RS256', expiresIn: '15m' });
}

export function verifyAccessToken(publicKeyPem: string, token: string): AccessTokenClaims & JwtPayload {
  return jwt.verify(token, publicKeyPem, { algorithms: ['RS256'] }) as AccessTokenClaims & JwtPayload;
}

export interface StepUpTokenClaims {
  sub: number;
  method: 'TOTP' | 'PIN';
}

export function signStepUpToken(privateKeyPem: string, claims: StepUpTokenClaims): string {
  return jwt.sign(claims, privateKeyPem, { algorithm: 'RS256', expiresIn: '120s' });
}

export function verifyStepUpToken(publicKeyPem: string, token: string): StepUpTokenClaims & JwtPayload {
  return jwt.verify(token, publicKeyPem, { algorithms: ['RS256'] }) as StepUpTokenClaims & JwtPayload;
}
