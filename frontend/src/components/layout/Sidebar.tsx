import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Send,
  ArrowDownLeft,
  History,
  Scale,
  ShieldAlert,
  Activity,
  KeyRound,
  LogOut,
  Sliders,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  const navItems = [
    { label: 'Dashboard', href: '/', icon: LayoutDashboard },
    { label: 'Send Money', href: '/send', icon: Send },
    { label: 'Money Requests', href: '/requests', icon: ArrowDownLeft },
    { label: 'Transaction History', href: '/history', icon: History },
    { label: 'Limits & Velocity', href: '/limits', icon: Sliders },
  ];

  const adminItems = [
    { label: 'Admin Dispute Queue', href: '/admin/disputes', icon: ShieldAlert },
    { label: 'System Health & Tests', href: '/admin', icon: Activity },
  ];

  const proofItems = [
    { label: 'Ledger Integrity Proof', href: '/integrity', icon: Scale },
  ];

  return (
    <aside className="hidden lg:flex flex-col fixed left-0 top-0 h-full py-5 px-3 w-64 bg-surface-container-low border-r border-outline-variant z-40">
      {/* Brand Header */}
      <div className="mb-6 px-3">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-white font-bold text-sm shadow-xs">
            KL
          </div>
          <div>
            <h1 className="font-bold text-lg text-primary tracking-tight leading-none">Kinetic Ledger</h1>
            <p className="text-[10px] uppercase font-semibold tracking-wider text-on-surface-variant mt-0.5">
              Money Movement App
            </p>
          </div>
        </div>
      </div>

      {/* Quick Action Button */}
      <div className="px-1 mb-6">
        <Link
          href="/send"
          className="w-full bg-primary text-white font-semibold text-xs py-2.5 px-4 rounded flex items-center justify-center gap-2 hover:bg-primary-hover shadow-xs transition-colors"
        >
          <Send className="w-4 h-4" />
          <span>New Transfer</span>
        </Link>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 flex flex-col gap-1 overflow-y-auto px-1">
        <div className="text-[10px] font-bold text-outline uppercase px-2 mb-1">Account</div>
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded text-xs font-semibold transition-colors ${
                isActive
                  ? 'bg-primary-container text-white shadow-xs'
                  : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}

        {/* Admin Section */}
        <div className="text-[10px] font-bold text-outline uppercase px-2 mt-5 mb-1">Operations & Admin</div>
        {adminItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded text-xs font-semibold transition-colors ${
                isActive
                  ? 'bg-primary-container text-white shadow-xs'
                  : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}

        {/* System Proof Page */}
        <div className="text-[10px] font-bold text-outline uppercase px-2 mt-5 mb-1">Judge Verification</div>
        {proofItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded text-xs font-semibold transition-colors ${
                isActive
                  ? 'bg-emerald-800 text-white shadow-xs'
                  : 'text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0 text-emerald-700" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* User Status / Footer */}
      <div className="mt-auto border-t border-outline-variant pt-3 px-2 flex flex-col gap-2">
        <Link
          href="/totp"
          className="flex items-center gap-2 px-2 py-1.5 rounded text-xs text-on-surface-variant hover:bg-surface-container-high transition-colors"
        >
          <KeyRound className="w-4 h-4 text-primary" />
          <span>Security / TOTP</span>
        </Link>
        <div className="flex items-center justify-between p-2 rounded bg-surface-container border border-outline-variant">
          <div className="truncate">
            <p className="text-xs font-bold text-on-surface truncate">{user?.name || 'Guest'}</p>
            <p className="text-[10px] text-on-surface-variant font-mono truncate">{user?.phone || 'Not logged in'}</p>
          </div>
          <button
            onClick={logout}
            title="Sign Out"
            className="p-1 text-on-surface-variant hover:text-error transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
