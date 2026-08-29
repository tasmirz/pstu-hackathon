/**
 * Money is BIGINT paisa everywhere on the wire and in the DB — never a float.
 * ৳1.00 = 100 paisa. These are display-only helpers; nothing here should ever
 * feed back into a calculation.
 */

export function taka(paisa: number): string {
  const sign = paisa < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(paisa));
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, '0');
  return `${sign}৳${whole.toLocaleString('en-US')}.${frac}`;
}

export function paisaFromTaka(takaAmount: number): number {
  return Math.round(takaAmount * 100);
}

export function isValidPaisaAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
