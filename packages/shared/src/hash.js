"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha256 = sha256;
exports.canonical = canonical;
const crypto_1 = require("crypto");
function sha256(input) {
    return (0, crypto_1.createHash)('sha256').update(input).digest('hex');
}
function canonical(obj) {
    return JSON.stringify(obj, Object.keys(obj).sort());
}
//# sourceMappingURL=hash.js.map