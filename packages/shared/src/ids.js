"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.newTxnRef = newTxnRef;
const ulid_1 = require("ulid");
function newTxnRef() {
    return `TXN_${(0, ulid_1.ulid)()}`;
}
//# sourceMappingURL=ids.js.map