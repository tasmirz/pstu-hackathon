import { mockEngine } from './mock-engine';
import {
  AuthResponse,
  BalanceResponse,
  LimitsResponse,
  Transaction,
  MoneyRequest,
  Dispute,
  Bill,
  IntegrityCheckReport,
  SystemHealth,
  SystemMetrics,
  LoadTestResult,
  NotificationItem,
  User,
} from './types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

class ApiClient {
  private accessToken: string | null = null;
  // Default to the REAL backend — the simulator board (88/88) is the demo.
  // The mock engine stays available via the UserSwitcher toggle for a
  // zero-dependency fallback, but the live API is the primary path now.
  private isMockMode: boolean = false;

  constructor() {
    if (typeof window !== 'undefined') {
      const storedMock = localStorage.getItem('kinetic_api_mock_mode');
      if (storedMock !== null) {
        this.isMockMode = storedMock === 'true';
      }
      this.accessToken = sessionStorage.getItem('kinetic_access_token');
    }
  }

  public getMockMode(): boolean {
    return this.isMockMode;
  }

  public setMockMode(enabled: boolean) {
    this.isMockMode = enabled;
    if (typeof window !== 'undefined') {
      localStorage.setItem('kinetic_api_mock_mode', enabled ? 'true' : 'false');
    }
  }

  public setTokens(accessToken: string, refreshToken: string) {
    this.accessToken = accessToken;
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('kinetic_access_token', accessToken);
      localStorage.setItem('kinetic_refresh_token', refreshToken);
    }
  }

  public clearTokens() {
    this.accessToken = null;
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('kinetic_access_token');
      localStorage.removeItem('kinetic_refresh_token');
    }
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    if (!this.accessToken && typeof window !== 'undefined') {
      this.accessToken = sessionStorage.getItem('kinetic_access_token');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    try {
      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers,
      });

      if (res.status === 401) {
        const refreshed = await this.refreshToken();
        if (refreshed) {
          headers['Authorization'] = `Bearer ${this.accessToken}`;
          const retryRes = await fetch(`${API_BASE_URL}${endpoint}`, {
            ...options,
            headers,
          });
          if (!retryRes.ok) {
            const errData = await retryRes.json().catch(() => ({}));
            throw { status: retryRes.status, ...errData };
          }
          return retryRes.json();
        } else {
          this.clearTokens();
          throw { status: 401, error: 'UNAUTHENTICATED', message: 'Session expired' };
        }
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw { status: res.status, ...errData };
      }

      return res.json();
    } catch (err: any) {
      if (err.status) throw err;
      console.warn('Real API unreachable, fallback to Mock Engine:', err);
      throw { status: 503, error: 'NETWORK_ERROR', message: 'Cannot connect to backend server' };
    }
  }

  private async refreshToken(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    const rt = localStorage.getItem('kinetic_refresh_token');
    if (!rt) return false;

    try {
      const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: rt }),
      });
      if (res.ok) {
        const data = await res.json();
        this.setTokens(data.access_token, data.refresh_token);
        return true;
      }
    } catch {
      // ignore
    }
    return false;
  }

  // --- API METHODS ---

  public async register(phone: string, name: string, pin: string): Promise<AuthResponse> {
    if (this.isMockMode) {
      const res = await mockEngine.register(phone, name, pin);
      this.setTokens(res.access_token, res.refresh_token);
      return res;
    }
    const res = await this.request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ phone, name, pin }),
    });
    this.setTokens(res.access_token, res.refresh_token);
    return res;
  }

  public async login(phone: string, pin: string): Promise<AuthResponse> {
    if (this.isMockMode) {
      const res = await mockEngine.login(phone, pin);
      this.setTokens(res.access_token, res.refresh_token);
      return res;
    }
    const res = await this.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone, pin }),
    });
    this.setTokens(res.access_token, res.refresh_token);
    return res;
  }

  public async getMe(currentUserId?: number): Promise<User> {
    if (this.isMockMode && currentUserId) {
      return mockEngine.getUser(currentUserId);
    }
    return this.request<User>('/auth/me');
  }

  /** Real step-up: POST /auth/step-up {method:'PIN'|'TOTP', pin/code} -> {step_up_token}. */
  public async stepUp(codeOrPin: string, method: 'PIN' | 'TOTP' = 'PIN'): Promise<string> {
    if (this.isMockMode) {
      return `su_mock_${codeOrPin}`;
    }
    const body = method === 'TOTP'
      ? { method: 'TOTP', code: codeOrPin }
      : { method: 'PIN', pin: codeOrPin };
    const res = await this.request<{ step_up_token: string; expires_in: number }>('/auth/step-up', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return res.step_up_token;
  }

  public async setupTotp(): Promise<{ secret: string; otpauth_url: string }> {
    if (this.isMockMode) {
      return {
        secret: 'JBSWY3DPEHPK3PXP',
        otpauth_url: 'otpauth://totp/KineticLedger:user?secret=JBSWY3DPEHPK3PXP&issuer=KineticLedger',
      };
    }
    return this.request<{ secret: string; otpauth_url: string }>('/auth/totp/setup', {
      method: 'POST',
    });
  }

  public async verifyTotp(code: string): Promise<{ success: boolean; message: string }> {
    if (this.isMockMode) {
      return { success: true, message: 'TOTP verified' };
    }
    return this.request<{ success: boolean; message: string }>('/auth/totp/verify', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }

  public async lookupUser(phone: string) {
    if (this.isMockMode) {
      return mockEngine.lookupUser(phone);
    }
    return this.request<{ id: number; name: string; phone: string; is_first_time: boolean }>(
      `/users/lookup?phone=${encodeURIComponent(phone)}`
    );
  }

  public async getBalance(userId: number): Promise<BalanceResponse> {
    if (this.isMockMode) {
      return mockEngine.getBalance(userId);
    }
    return this.request<BalanceResponse>('/accounts/me/balance');
  }

  public async getLimits(userId: number): Promise<LimitsResponse> {
    if (this.isMockMode) {
      return mockEngine.getLimits(userId);
    }
    return this.request<LimitsResponse>('/accounts/me/limits');
  }

  public async createTransfer(
    senderId: number,
    toPhone: string,
    amountPaisa: number,
    note?: string,
    idempotencyKey?: string,
    stepUpToken?: string
  ): Promise<{ statusCode: number; transaction: Transaction; balance_paisa: number; entries?: any[]; can_cancel_until?: string }> {
    if (this.isMockMode) {
      return mockEngine.createTransfer(senderId, toPhone, amountPaisa, note, idempotencyKey, stepUpToken);
    }

    const headers: Record<string, string> = {};
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    if (stepUpToken) headers['X-Step-Up-Token'] = stepUpToken;

    return this.request<any>('/transfers', {
      method: 'POST',
      headers,
      body: JSON.stringify({ to_phone: toPhone, amount_paisa: amountPaisa, note }),
    });
  }

  public async cancelHoldTransfer(userId: number, txnId: number, idempotencyKey?: string) {
    if (this.isMockMode) {
      return mockEngine.cancelHoldTransfer(userId, txnId);
    }
    const headers: Record<string, string> = {};
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    return this.request<any>(`/transfers/${txnId}/cancel`, {
      method: 'POST',
      headers,
    });
  }

  public async reverseTransaction(userId: number, txnId: number, reason: string, idempotencyKey?: string, stepUpToken?: string) {
    if (this.isMockMode) {
      return mockEngine.reverseTransaction(userId, txnId, reason);
    }
    const headers: Record<string, string> = {};
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    if (stepUpToken) headers['X-Step-Up-Token'] = stepUpToken;
    return this.request<any>(`/transactions/${txnId}/reverse`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ reason }),
    });
  }

  public async raiseDispute(userId: number, txnId: number, reason: string) {
    if (this.isMockMode) {
      return mockEngine.raiseDispute(userId, txnId, reason);
    }
    return this.request<Dispute>('/disputes', {
      method: 'POST',
      body: JSON.stringify({ txn_id: txnId, reason }),
    });
  }

  public async getDisputes(userId?: number): Promise<Dispute[]> {
    if (this.isMockMode) {
      return mockEngine.getDisputes(userId);
    }
    const res = await this.request<{ items?: Dispute[] }>('/disputes');
    return Array.isArray(res) ? res : (res.items ?? []);
  }

  // --- SHARED BILLS ---

  public async createBill(creatorId: number, title: string, shares: Array<{ phone: string; amount_paisa: number }>) {
    if (this.isMockMode) {
      return mockEngine.createBill(creatorId, title, shares);
    }
    return this.request<Bill>('/bills', {
      method: 'POST',
      body: JSON.stringify({ title, shares }),
    });
  }

  public async getBills(userId: number, role: 'created' | 'owed'): Promise<Bill[]> {
    if (this.isMockMode) {
      return mockEngine.getBills(userId, role);
    }
    const res = await this.request<{ items?: Bill[] }>(`/bills/mine?role=${role}`);
    return Array.isArray(res) ? res : (res.items ?? []);
  }

  public async getBill(id: number): Promise<Bill> {
    if (this.isMockMode) {
      return mockEngine.getBill(id);
    }
    return this.request<Bill>(`/bills/${id}`);
  }

  public async payBillShare(payerId: number, billId: number, idempotencyKey?: string, stepUpToken?: string) {
    if (this.isMockMode) {
      return mockEngine.payBillShare(payerId, billId);
    }
    const headers: Record<string, string> = {};
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    if (stepUpToken) headers['X-Step-Up-Token'] = stepUpToken;
    return this.request<any>(`/bills/${billId}/pay`, {
      method: 'POST',
      headers,
    });
  }

  public async cancelBill(userId: number, billId: number) {
    if (this.isMockMode) {
      return mockEngine.cancelBill(userId, billId);
    }
    return this.request<Bill>(`/bills/${billId}/cancel`, {
      method: 'POST',
    });
  }

  // --- MONEY REQUESTS ---

  public async createMoneyRequest(fromUserId: number, toPhone: string, amountPaisa: number, note?: string) {
    if (this.isMockMode) {
      return mockEngine.createMoneyRequest(fromUserId, toPhone, amountPaisa, note);
    }
    return this.request<MoneyRequest>('/money-requests', {
      method: 'POST',
      body: JSON.stringify({ from_phone: toPhone, amount_paisa: amountPaisa, note }),
    });
  }

  public async payMoneyRequest(payerId: number, reqId: number, idempotencyKey?: string, stepUpToken?: string) {
    if (this.isMockMode) {
      return mockEngine.payMoneyRequest(payerId, reqId);
    }
    const headers: Record<string, string> = {};
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    if (stepUpToken) headers['X-Step-Up-Token'] = stepUpToken;
    return this.request<any>(`/money-requests/${reqId}/pay`, {
      method: 'POST',
      headers,
    });
  }

  public async declineMoneyRequest(userId: number, reqId: number) {
    if (this.isMockMode) {
      return mockEngine.declineMoneyRequest(userId, reqId);
    }
    return this.request<any>(`/money-requests/${reqId}/decline`, {
      method: 'POST',
    });
  }

  public async cancelMoneyRequest(userId: number, reqId: number) {
    if (this.isMockMode) {
      return mockEngine.cancelMoneyRequest(userId, reqId);
    }
    return this.request<any>(`/money-requests/${reqId}/cancel`, {
      method: 'POST',
    });
  }

  public async getTransactions(
    userId: number,
    limit = 20,
    cursor?: number,
    direction = 'all'
  ): Promise<{ items: Transaction[]; next_cursor: number | null; has_more: boolean }> {
    if (this.isMockMode) {
      return mockEngine.getTransactions(userId, limit, cursor, direction);
    }
    const params = new URLSearchParams({ limit: limit.toString(), direction });
    if (cursor) params.set('cursor', cursor.toString());
    return this.request<{ items: Transaction[]; next_cursor: number | null; has_more: boolean }>(
      `/transactions?${params.toString()}`
    );
  }

  public async getTransaction(id: number): Promise<Transaction> {
    if (this.isMockMode) {
      return mockEngine.getTransaction(id);
    }
    return this.request<Transaction>(`/transactions/${id}`);
  }

  public async getMoneyRequests(userId: number, type: 'incoming' | 'outgoing'): Promise<MoneyRequest[]> {
    if (this.isMockMode) {
      return mockEngine.getMoneyRequests(userId, type);
    }
    // Backend returns {items, next_cursor, has_more}; the UI consumes a plain
    // array (same shape the mock engine returns), so normalize here.
    const res = await this.request<{ items?: MoneyRequest[] }>(`/money-requests/${type}`);
    return Array.isArray(res) ? res : (res.items ?? []);
  }

  public async getNotifications(): Promise<NotificationItem[]> {
    if (this.isMockMode) {
      return mockEngine.getNotifications();
    }
    const res = await this.request<{ items?: NotificationItem[] }>('/notifications');
    return Array.isArray(res) ? res : (res.items ?? []);
  }

  public async getIntegrityReport(): Promise<IntegrityCheckReport> {
    if (this.isMockMode) {
      return mockEngine.getIntegrityReport();
    }
    return this.request<IntegrityCheckReport>('/admin/integrity');
  }

  public async getSystemHealth(): Promise<SystemHealth> {
    if (this.isMockMode) {
      return mockEngine.getSystemHealth();
    }
    return this.request<SystemHealth>('/admin/health');
  }

  public async getSystemMetrics(): Promise<SystemMetrics> {
    if (this.isMockMode) {
      return mockEngine.getSystemMetrics();
    }
    return this.request<SystemMetrics>('/admin/metrics');
  }

  public async runLoadTest(): Promise<LoadTestResult> {
    if (this.isMockMode) {
      return mockEngine.runLoadTest();
    }
    return this.request<LoadTestResult>('/admin/load-test', {
      method: 'POST',
      body: JSON.stringify({ accounts: 200, transfers: 5000, concurrency: 200 }),
    });
  }

  public async resolveDispute(disputeId: number, action: 'REVERSE' | 'REJECT', resolution: string, idempotencyKey?: string) {
    if (this.isMockMode) {
      return mockEngine.resolveDispute(disputeId, action, resolution);
    }
    const headers: Record<string, string> = {};
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    return this.request<any>(`/admin/disputes/${disputeId}/resolve`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action, resolution }),
    });
  }

  public async getAdminDisputes(limit = 20, cursor?: number): Promise<{ items: Dispute[]; next_cursor: number | null; has_more: boolean }> {
    if (this.isMockMode) {
      const items = await mockEngine.getDisputes();
      return { items, next_cursor: null, has_more: false };
    }
    const params = new URLSearchParams({ limit: limit.toString() });
    if (cursor) params.set('cursor', cursor.toString());
    return this.request<{ items: Dispute[]; next_cursor: number | null; has_more: boolean }>(
      `/admin/disputes?${params.toString()}`
    );
  }

  public async freezeAccount(phoneOrId: string | number, reason: string, stepUpToken?: string) {
    if (this.isMockMode) {
      return mockEngine.freezeAccount(phoneOrId.toString(), reason);
    }
    let targetId: number;
    if (typeof phoneOrId === 'number') {
      targetId = phoneOrId;
    } else {
      const lookup = await this.lookupUser(phoneOrId);
      targetId = lookup.id;
    }
    const headers: Record<string, string> = {};
    if (stepUpToken) headers['X-Step-Up-Token'] = stepUpToken;
    return this.request<any>(`/admin/accounts/${targetId}/freeze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ reason }),
    });
  }

  public async unfreezeAccount(phoneOrId: string | number, reason: string, stepUpToken?: string) {
    if (this.isMockMode) {
      return mockEngine.unfreezeAccount(phoneOrId.toString(), reason);
    }
    let targetId: number;
    if (typeof phoneOrId === 'number') {
      targetId = phoneOrId;
    } else {
      const lookup = await this.lookupUser(phoneOrId);
      targetId = lookup.id;
    }
    const headers: Record<string, string> = {};
    if (stepUpToken) headers['X-Step-Up-Token'] = stepUpToken;
    return this.request<any>(`/admin/accounts/${targetId}/unfreeze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ reason }),
    });
  }

  public async rebuildBalance(userId: number) {
    if (this.isMockMode) {
      return mockEngine.rebuildBalance(userId);
    }
    return this.request<any>(`/admin/accounts/${userId}/rebuild-balance`, {
      method: 'POST',
    });
  }
}

export const api = new ApiClient();
