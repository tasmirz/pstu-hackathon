import { ulid } from 'ulid';

/** App-generated, monotonic, human-scannable transaction reference. */
export function newTxnRef(): string {
  return `TXN_${ulid()}`;
}
