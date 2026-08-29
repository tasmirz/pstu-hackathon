'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User, BalanceResponse, NotificationItem } from './types';
import { api } from './api';
import { mockEngine } from './mock-engine';
import { PERSONAS } from '@/components/common/UserSwitcher';

interface AuthContextType {
  user: User | null;
  balance: number;
  heldBalance: number;
  availableBalance: number;
  isLoading: boolean;
  isMockMode: boolean;
  balanceUpdated: boolean;
  unreadCount: number;
  notifications: NotificationItem[];
  stepUpOpen: boolean;
  stepUpReason: string;
  stepUpResolver: ((token: string | null) => void) | null;
  toggleMockMode: () => void;
  login: (phone: string, pin: string) => Promise<any>;
  register: (phone: string, name: string, pin: string) => Promise<any>;
  logout: () => void;
  switchUser: (userId: number) => Promise<void>;
  refreshBalance: () => Promise<void>;
  requestStepUp: (reason?: string) => Promise<string | null>;
  closeStepUp: (token: string | null) => void;
  resetDemoData: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Default seeded persona: Rahim Ahmed (#42)
  const [user, setUser] = useState<User | null>({
    id: 42,
    phone: '+8801712345678',
    name: 'Rahim Ahmed',
    status: 'ACTIVE',
    role: 'USER',
    totp_enrolled: true,
  });

  const [balance, setBalance] = useState<number>(9750000);
  const [heldBalance, setHeldBalance] = useState<number>(1000000);
  const [availableBalance, setAvailableBalance] = useState<number>(8750000);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isMockMode, setIsMockMode] = useState<boolean>(false);
  const [balanceUpdated, setBalanceUpdated] = useState<boolean>(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  // Step-up Challenge state
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpReason, setStepUpReason] = useState('VERIFICATION_REQUIRED');
  const [stepUpResolver, setStepUpResolver] = useState<((token: string | null) => void) | null>(null);

  const refreshBalance = useCallback(async () => {
    if (!user) return;
    try {
      const res: BalanceResponse = await api.getBalance(user.id);
      if (res && typeof res.balance_paisa === 'number') {
        setBalance(res.balance_paisa);
        setHeldBalance(res.held_paisa ?? 0);
        setAvailableBalance(res.available_paisa ?? res.balance_paisa);
      }
    } catch (err: any) {
      // 401 unauthenticated happens transiently on cold load before session restore
      if (err?.status === 401) {
        return;
      }
      console.warn('Balance refresh deferred:', err?.message || err);
    }
  }, [user]);

  const loadNotifications = useCallback(async () => {
    try {
      const items = await api.getNotifications();
      setNotifications(items);
    } catch {
      // ignore
    }
  }, []);

  // Subscribe to live events from Mock Engine & Centrifugo
  useEffect(() => {
    const mock = api.getMockMode();
    setIsMockMode(mock);

    // Real mode: ensure we have a real session for a demo persona. The login
    // screen / UserSwitcher set a token on login; when none is present yet,
    // auto-sign-in as Rahim (the primary demo persona) so the dashboard is
    // live against the backend instead of a hard-coded mock balance.
    if (!mock) {
      const restore = async () => {
        try {
          const me = await api.getMe();
          setUser(me);
          await refreshBalance();
          await loadNotifications();
        } catch {
          try {
            await api.login(PERSONAS[0].phone, PERSONAS[0].pin);
            setUser((await api.getMe()));
            await refreshBalance();
            await loadNotifications();
          } catch {
            // no backend reachable — stay on the login screen
          }
        }
      };
      void restore();
    } else {
      refreshBalance();
      loadNotifications();
    }

    const unsubscribe = mockEngine.subscribe((event, data) => {
      // Flash balance animation
      setBalanceUpdated(true);
      setTimeout(() => setBalanceUpdated(false), 1200);

      refreshBalance();
      loadNotifications();
    });

    return () => {
      unsubscribe();
    };
  }, [refreshBalance, loadNotifications]);

  const login = async (phone: string, pin: string) => {
    setIsLoading(true);
    try {
      const res = await api.login(phone, pin);
      setUser(res.user);
      await refreshBalance();
      return res;
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (phone: string, name: string, pin: string) => {
    setIsLoading(true);
    try {
      const res = await api.register(phone, name, pin);
      setUser(res.user);
      await refreshBalance();
      return res;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    api.clearTokens();
    setUser(null);
    setBalance(0);
    setHeldBalance(0);
    setAvailableBalance(0);
  };

  const switchUser = async (userId: number) => {
    setIsLoading(true);
    try {
      if (!isMockMode) {
        // Real mode: log in as the persona via the real API (phone + pin),
        // so the token/balance/notifications all come from the live backend.
        const persona = PERSONAS.find((p) => p.id === userId);
        if (persona) {
          const res = await api.login(persona.phone, persona.pin);
          setUser(res.user);
          const bal = await api.getBalance(userId);
          setBalance(bal.balance_paisa);
          setHeldBalance(bal.held_paisa);
          setAvailableBalance(bal.available_paisa);
          await loadNotifications();
          return;
        }
      }
      const u = await api.getMe(userId);
      setUser(u);
      const bal = await api.getBalance(userId);
      setBalance(bal.balance_paisa);
      setHeldBalance(bal.held_paisa);
      setAvailableBalance(bal.available_paisa);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleMockMode = () => {
    const next = !isMockMode;
    setIsMockMode(next);
    api.setMockMode(next);
    refreshBalance();
  };

  const requestStepUp = (reason = 'STEP_UP_REQUIRED'): Promise<string | null> => {
    setStepUpReason(reason);
    setStepUpOpen(true);
    return new Promise((resolve) => {
      setStepUpResolver(() => resolve);
    });
  };

  const closeStepUp = (token: string | null) => {
    setStepUpOpen(false);
    if (stepUpResolver) {
      stepUpResolver(token);
      setStepUpResolver(null);
    }
  };

  const resetDemoData = () => {
    mockEngine.resetState();
    refreshBalance();
    loadNotifications();
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <AuthContext.Provider
      value={{
        user,
        balance,
        heldBalance,
        availableBalance,
        isLoading,
        isMockMode,
        balanceUpdated,
        unreadCount,
        notifications,
        stepUpOpen,
        stepUpReason,
        stepUpResolver,
        toggleMockMode,
        login,
        register,
        logout,
        switchUser,
        refreshBalance,
        requestStepUp,
        closeStepUp,
        resetDemoData,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
