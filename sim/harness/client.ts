import { simConfig } from '../config';

/**
 * Typed API client — SIMULATOR.md §2 "client.ts: typed API client; every call
 * returns {status, body, ms}". Scenarios never call fetch directly; every
 * network interaction goes through this, so the abort/step-up/header plumbing
 * is written once. This is deliberately NOT a full SDK — it exposes the raw
 * `{status, body, ms}` shape so scenarios can assert on HTTP behaviour, not
 * just happy-path payloads.
 */

export interface ApiResult<T = any> {
  status: number;
  body: T;
  ms: number;
  headers: Record<string, string>;
}

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  user: { id: number; phone: string; name: string; status: string };
  signup_bonus_paisa?: number;
  balance_paisa?: number;
}

export interface SimUser extends AuthSession {
  /** deterministic PIN used for step-up in scenarios */
  pin: string;
}

export class ApiClient {
  readonly baseUrl: string;

  constructor(baseUrl: string = simConfig.apiBaseUrl) {
    this.baseUrl = baseUrl;
  }

  async request<T = any>(
    method: string,
    path: string,
    opts: {
      token?: string;
      json?: unknown;
      headers?: Record<string, string>;
      signal?: AbortSignal;
    } = {},
  ): Promise<ApiResult<T>> {
    const start = Date.now();
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
    let body: string | undefined;
    if (opts.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.json);
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body,
      signal: opts.signal,
    });
    const ms = Date.now() - start;

    const text = await res.text();
    let parsed: T | null = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text as unknown as T;
    }

    const headersOut: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headersOut[k] = v;
    });

    return { status: res.status, body: parsed as T, ms, headers: headersOut };
  }

  // ---- auth ----

  register(phone: string, name: string, pin: string): Promise<ApiResult<AuthSession>> {
    return this.request('POST', '/auth/register', { json: { phone, name, pin } });
  }

  login(phone: string, pin: string): Promise<ApiResult<AuthSession>> {
    return this.request('POST', '/auth/login', { json: { phone, pin } });
  }

  refresh(refresh_token: string): Promise<ApiResult<{ access_token: string; refresh_token: string }>> {
    return this.request('POST', '/auth/refresh', { json: { refresh_token } });
  }

  logout(refresh_token: string): Promise<ApiResult<{ logged_out: boolean }>> {
    return this.request('POST', '/auth/logout', { json: { refresh_token } });
  }

  logoutAll(token: string): Promise<ApiResult<{ sessions_revoked: number }>> {
    return this.request('POST', '/auth/logout-all', { token });
  }

  me(token: string): Promise<ApiResult<any>> {
    return this.request('GET', '/auth/me', { token });
  }

  stepUp(token: string, method: 'PIN' | 'TOTP', value: string): Promise<ApiResult<{ step_up_token: string; expires_in: number }>> {
    const body = method === 'PIN' ? { method, pin: value } : { method, code: value };
    return this.request('POST', '/auth/step-up', { token, json: body });
  }

  // ---- writes ----

  transfer(
    token: string,
    to_phone: string,
    amount_paisa: number,
    opts: { note?: string; idemKey: string; stepUpToken?: string; signal?: AbortSignal } = { idemKey: '' },
  ): Promise<ApiResult<any>> {
    const headers: Record<string, string> = { 'Idempotency-Key': opts.idemKey };
    if (opts.stepUpToken) headers['X-Step-Up-Token'] = opts.stepUpToken;
    return this.request('POST', '/transfers', {
      token,
      headers,
      json: { to_phone, amount_paisa, note: opts.note },
      signal: opts.signal,
    });
  }

  cancelTransfer(token: string, txnId: number, idemKey: string): Promise<ApiResult<any>> {
    return this.request('POST', `/transfers/${txnId}/cancel`, {
      token,
      headers: { 'Idempotency-Key': idemKey },
    });
  }

  reverse(token: string, txnId: number, idemKey: string, stepUpToken?: string): Promise<ApiResult<any>> {
    const headers: Record<string, string> = { 'Idempotency-Key': idemKey };
    if (stepUpToken) headers['X-Step-Up-Token'] = stepUpToken;
    return this.request('POST', `/transactions/${txnId}/reverse`, { token, headers });
  }

  createRequest(token: string, from_phone: string, amount_paisa: number, note?: string): Promise<ApiResult<any>> {
    return this.request('POST', '/money-requests', { token, json: { from_phone, amount_paisa, note } });
  }

  payRequest(token: string, requestId: number, idemKey: string, stepUpToken?: string): Promise<ApiResult<any>> {
    const headers: Record<string, string> = { 'Idempotency-Key': idemKey };
    if (stepUpToken) headers['X-Step-Up-Token'] = stepUpToken;
    return this.request('POST', `/money-requests/${requestId}/pay`, { token, headers });
  }

  declineRequest(token: string, requestId: number): Promise<ApiResult<any>> {
    return this.request('POST', `/money-requests/${requestId}/decline`, { token });
  }

  cancelRequest(token: string, requestId: number): Promise<ApiResult<any>> {
    return this.request('POST', `/money-requests/${requestId}/cancel`, { token });
  }

  remindRequest(token: string, requestId: number): Promise<ApiResult<any>> {
    return this.request('POST', `/money-requests/${requestId}/remind`, { token });
  }

  incomingRequests(
    token: string,
    q: { limit?: number; cursor?: number; state?: string } = {},
  ): Promise<ApiResult<any>> {
    const params = new URLSearchParams();
    if (q.limit !== undefined) params.set('limit', String(q.limit));
    if (q.cursor !== undefined) params.set('cursor', String(q.cursor));
    if (q.state !== undefined) params.set('state', q.state);
    const qs = params.toString();
    return this.request('GET', `/money-requests/incoming${qs ? '?' + qs : ''}`, { token });
  }

  outgoingRequests(
    token: string,
    q: { limit?: number; cursor?: number; state?: string } = {},
  ): Promise<ApiResult<any>> {
    const params = new URLSearchParams();
    if (q.limit !== undefined) params.set('limit', String(q.limit));
    if (q.cursor !== undefined) params.set('cursor', String(q.cursor));
    if (q.state !== undefined) params.set('state', q.state);
    const qs = params.toString();
    return this.request('GET', `/money-requests/outgoing${qs ? '?' + qs : ''}`, { token });
  }

  raiseDispute(token: string, txn_id: number, reason: string): Promise<ApiResult<any>> {
    return this.request('POST', '/disputes', { token, json: { txn_id, reason } });
  }

  myDisputes(token: string): Promise<ApiResult<any>> {
    return this.request('GET', '/disputes', { token });
  }

  createBill(token: string, title: string, shares: Array<{ phone: string; amount_paisa: number }>): Promise<ApiResult<any>> {
    return this.request('POST', '/bills', { token, json: { title, shares } });
  }

  payBill(token: string, billId: number, idemKey: string, stepUpToken?: string): Promise<ApiResult<any>> {
    const headers: Record<string, string> = { 'Idempotency-Key': idemKey };
    if (stepUpToken) headers['X-Step-Up-Token'] = stepUpToken;
    return this.request('POST', `/bills/${billId}/pay`, { token, headers });
  }

  getBill(token: string, billId: number): Promise<ApiResult<any>> {
    return this.request('GET', `/bills/${billId}`, { token });
  }

  cancelBill(token: string, billId: number): Promise<ApiResult<any>> {
    return this.request('POST', `/bills/${billId}/cancel`, { token });
  }

  // ---- reads ----

  balance(token: string): Promise<ApiResult<{ balance_paisa: number; held_paisa: number; available_paisa: number }>> {
    return this.request('GET', '/accounts/me/balance', { token });
  }

  limits(token: string): Promise<ApiResult<any>> {
    return this.request('GET', '/accounts/me/limits', { token });
  }

  transactions(
    token: string,
    q: { limit?: number; cursor?: number; direction?: 'sent' | 'received' | 'all'; kind?: string } = {},
  ): Promise<ApiResult<any>> {
    const params = new URLSearchParams();
    if (q.limit !== undefined) params.set('limit', String(q.limit));
    if (q.cursor !== undefined) params.set('cursor', String(q.cursor));
    if (q.direction !== undefined) params.set('direction', q.direction);
    if (q.kind !== undefined) params.set('kind', q.kind);
    const qs = params.toString();
    return this.request('GET', `/transactions${qs ? '?' + qs : ''}`, { token });
  }

  transaction(token: string, id: number): Promise<ApiResult<any>> {
    return this.request('GET', `/transactions/${id}`, { token });
  }

  lookup(token: string, phone: string): Promise<ApiResult<any>> {
    return this.request('GET', `/users/lookup?phone=${encodeURIComponent(phone)}`, { token });
  }

  // ---- admin ----

  integrity(token: string): Promise<ApiResult<any>> {
    return this.request('GET', '/admin/integrity', { token });
  }

  adminDisputes(token: string): Promise<ApiResult<any>> {
    return this.request('GET', '/admin/disputes', { token });
  }

  resolveDispute(token: string, disputeId: number, action: 'REVERSE' | 'REJECT', resolution: string, idemKey: string, stepUpToken?: string): Promise<ApiResult<any>> {
    const headers: Record<string, string> = { 'Idempotency-Key': idemKey };
    if (stepUpToken) headers['X-Step-Up-Token'] = stepUpToken;
    return this.request('POST', `/admin/disputes/${disputeId}/resolve`, {
      token,
      headers,
      json: { action, resolution },
    });
  }

  freeze(token: string, userId: number, reason: string, stepUpToken?: string): Promise<ApiResult<any>> {
    const headers: Record<string, string> = {};
    if (stepUpToken) headers['X-Step-Up-Token'] = stepUpToken;
    return this.request('POST', `/admin/accounts/${userId}/freeze`, { token, headers, json: { reason } });
  }

  unfreeze(token: string, userId: number, reason: string, stepUpToken?: string): Promise<ApiResult<any>> {
    const headers: Record<string, string> = {};
    if (stepUpToken) headers['X-Step-Up-Token'] = stepUpToken;
    return this.request('POST', `/admin/accounts/${userId}/unfreeze`, { token, headers, json: { reason } });
  }
}

/**
 * SIMULATOR.md §3.1 — the user's phone loses signal AFTER the request left.
 * The server still processes it; the client never learns the outcome.
 */
export async function abortAfter(
  ms: number,
  fn: (signal: AbortSignal) => Promise<unknown>,
): Promise<{ aborted: boolean; res?: unknown }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return { aborted: false, res: await fn(ac.signal) };
  } catch {
    return { aborted: true };
  } finally {
    clearTimeout(timer);
  }
}