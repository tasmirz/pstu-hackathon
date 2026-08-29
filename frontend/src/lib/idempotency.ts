/**
 * Idempotency Key Management
 * 
 * Prevents double-debit bugs.
 * A retry after timeout or step-up MUST reuse the same key.
 */

export function getIdempotencyKey(formKey: string): string {
  if (typeof window === 'undefined') {
    return '00000000-0000-0000-0000-000000000000';
  }

  const storageKey = `idem:${formKey}`;
  let existing = sessionStorage.getItem(storageKey);
  if (!existing) {
    existing = crypto.randomUUID();
    sessionStorage.setItem(storageKey, existing);
  }
  return existing;
}

export function clearIdempotencyKey(formKey: string): void {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(`idem:${formKey}`);
  }
}
