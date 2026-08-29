import React, { useState } from 'react';
import Link from 'next/link';
import { Bell, ShieldCheck, ArrowUpRight, Scale, Menu, X, RefreshCw } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { formatPaisa } from '@/lib/money';

export function Navbar({ onMobileMenuToggle }: { onMobileMenuToggle?: () => void }) {
  const { user, balance, heldBalance, balanceUpdated, refreshBalance, notifications, unreadCount } = useAuth();
  const [showNotifications, setShowNotifications] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const handleManualRefresh = async () => {
    setRefreshing(true);
    await refreshBalance();
    setTimeout(() => setRefreshing(false), 500);
  };

  return (
    <header className="sticky top-0 z-30 w-full bg-surface-container-lowest border-b border-outline-variant px-4 lg:px-8 py-3 flex items-center justify-between shadow-2xs">
      {/* Left: Mobile branding */}
      <div className="flex items-center gap-3">
        <button
          onClick={onMobileMenuToggle}
          className="lg:hidden p-1.5 rounded text-on-surface-variant hover:bg-surface-container transition-colors"
        >
          <Menu className="w-5 h-5" />
        </button>
        <Link href="/" className="lg:hidden flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-primary flex items-center justify-center text-white font-bold text-xs">
            KL
          </div>
          <span className="font-bold text-sm text-primary">Kinetic Ledger</span>
        </Link>
      </div>

      {/* Center/Right: Live Balance and Fast Actions */}
      <div className="flex items-center gap-3 md:gap-5 ml-auto">
        {/* Live Balance Widget */}
        <div
          className={`flex items-baseline gap-2 px-3 py-1.5 rounded border transition-all ${
            balanceUpdated
              ? 'bg-primary-fixed border-primary text-primary glow-update scale-102'
              : 'bg-surface-container-low border-outline-variant'
          }`}
        >
          <span className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider hidden sm:inline">
            Balance:
          </span>
          <span className="font-mono-data font-bold text-base md:text-lg text-primary tracking-tight">
            {formatPaisa(balance)}
          </span>
          {heldBalance > 0 && (
            <span className="text-[11px] font-semibold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded border border-amber-200" title="Funds temporarily on hold">
              {formatPaisa(heldBalance)} held
            </span>
          )}
          <button
            onClick={handleManualRefresh}
            title="Refresh balance from ledger primary"
            className={`text-on-surface-variant hover:text-primary transition-transform ${
              refreshing ? 'animate-spin' : ''
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Quick Integrity Link */}
        <Link
          href="/integrity"
          title="Verify 100% Ledger Balance & Conservation Proof"
          className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100 transition-colors"
        >
          <Scale className="w-3.5 h-3.5 text-emerald-700" />
          <span>Ledger Proof</span>
        </Link>

        {/* Notification Bell */}
        <div className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="p-2 rounded-full text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors relative"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 bg-error rounded-full" />
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 bg-surface-container-lowest border border-outline-variant rounded-lg shadow-lg p-3 z-50 animate-in fade-in zoom-in-95">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-outline-variant">
                <span className="text-xs font-bold text-on-surface">Notifications</span>
                <span className="text-[10px] text-on-surface-variant font-mono">Kafka Event Stream</span>
              </div>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {notifications.length === 0 ? (
                  <p className="text-xs text-on-surface-variant py-4 text-center">No notifications</p>
                ) : (
                  notifications.map((n) => (
                    <div key={n.id} className="p-2 rounded bg-surface-container-low border border-outline-variant text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-on-surface">{n.title}</span>
                        <span className="text-[10px] text-on-surface-variant">just now</span>
                      </div>
                      <p className="text-on-surface-variant mt-0.5 text-[11px]">{n.message}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
