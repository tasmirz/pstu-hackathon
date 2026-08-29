"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signAccessToken = signAccessToken;
exports.verifyAccessToken = verifyAccessToken;
exports.signStepUpToken = signStepUpToken;
exports.verifyStepUpToken = verifyStepUpToken;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
function signAccessToken(privateKeyPem, claims) {
    return jsonwebtoken_1.default.sign(claims, privateKeyPem, { algorithm: 'RS256', expiresIn: '15m' });
}
function verifyAccessToken(publicKeyPem, token) {
    return jsonwebtoken_1.default.verify(token, publicKeyPem, { algorithms: ['RS256'] });
}
function signStepUpToken(privateKeyPem, claims) {
    return jsonwebtoken_1.default.sign(claims, privateKeyPem, { algorithm: 'RS256', expiresIn: '120s' });
}
function verifyStepUpToken(publicKeyPem, token) {
    return jsonwebtoken_1.default.verify(token, publicKeyPem, { algorithms: ['RS256'] });
}
//# sourceMappingURL=jwt.js.map