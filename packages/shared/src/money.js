"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.taka = taka;
exports.paisaFromTaka = paisaFromTaka;
exports.isValidPaisaAmount = isValidPaisaAmount;
function taka(paisa) {
    const sign = paisa < 0 ? '-' : '';
    const abs = Math.abs(Math.trunc(paisa));
    const whole = Math.floor(abs / 100);
    const frac = (abs % 100).toString().padStart(2, '0');
    return `${sign}৳${whole.toLocaleString('en-US')}.${frac}`;
}
function paisaFromTaka(takaAmount) {
    return Math.round(takaAmount * 100);
}
function isValidPaisaAmount(value) {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
//# sourceMappingURL=money.js.map