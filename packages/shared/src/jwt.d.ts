import { JwtPayload } from 'jsonwebtoken';
export interface AccessTokenClaims {
    sub: number;
    tv: number;
    role: 'USER' | 'ADMIN';
}
export declare function signAccessToken(privateKeyPem: string, claims: AccessTokenClaims): string;
export declare function verifyAccessToken(publicKeyPem: string, token: string): AccessTokenClaims & JwtPayload;
export interface StepUpTokenClaims {
    sub: number;
    method: 'TOTP' | 'PIN';
}
export declare function signStepUpToken(privateKeyPem: string, claims: StepUpTokenClaims): string;
export declare function verifyStepUpToken(publicKeyPem: string, token: string): StepUpTokenClaims & JwtPayload;
