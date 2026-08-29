'use client';

import React, { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Navbar } from './Navbar';
import { UserSwitcher } from '../common/UserSwitcher';
import { StepUpModal } from '../common/StepUpModal';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Send, ArrowDownLeft, History, Scale, Activity } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  const { user } = useAuth();

  // If on /login, don't show full dashboard layout
  if (pathname === '/login') {
    return (
      <div className="min-h-screen bg-surface flex flex-col">
        <UserSwitcher />
        <main className="flex-1 flex items-center justify-center p-4">{children}</main>
        <StepUpModal />
      </div>
    );
  }

  const bottomNavItems = [
    { label: 'Home', href: '/', icon: LayoutDashboard },
    { label: 'Send', href: '/send', icon: Send },
    { label: 'Requests', href: '/requests', icon: ArrowDownLeft },
    { label: 'History', href: '/history', icon: History },
    { label: 'Proof', href: '/integrity', icon: Scale },
  ];

  return (
    <div className="min-h-screen bg-surface flex flex-col antialiased">
      {/* Top Demo Helper Bar */}
      <UserSwitcher />

      <div className="flex-1 flex">
        {/* Desktop Sidebar */}
        <Sidebar />

        {/* Mobile Slide-out Menu */}
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          >
            <div
              className="w-72 bg-surface-container-low h-full p-4 flex flex-col border-r border-outline-variant shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6 pb-2 border-b border-outline-variant">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-white font-bold text-sm">
                    KL
                  </div>
                  <span className="font-bold text-primary">Kinetic Ledger</span>
                </div>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1 text-on-surface-variant hover:text-on-surface"
                >
                  ✕
                </button>
              </div>

              <nav className="space-y-1">
                {[
                  { label: 'Dashboard', href: '/', icon: LayoutDashboard },
                  { label: 'Send Money', href: '/send', icon: Send },
                  { label: 'Money Requests', href: '/requests', icon: ArrowDownLeft },
                  { label: 'History', href: '/history', icon: History },
                  { label: 'Ledger Integrity Proof', href: '/integrity', icon: Scale },
                  { label: 'Admin Disputes', href: '/admin/disputes', icon: Activity },
                  { label: 'System Health', href: '/admin', icon: Activity },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded text-sm font-semibold ${
                        pathname === item.href ? 'bg-primary text-white' : 'text-on-surface-variant hover:bg-surface-container'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col lg:pl-64 min-w-0 pb-16 lg:pb-0">
          <Navbar onMobileMenuToggle={() => setMobileMenuOpen(true)} />
          <main className="flex-1 w-full max-w-[1280px] mx-auto p-4 sm:p-6 lg:p-8">
            {/* Frozen Account Alert Banner */}
            {user?.status === 'FROZEN' && (
              <div className="mb-6 p-4 rounded-lg bg-rose-50 border border-rose-300 text-rose-950 flex items-center justify-between text-xs sm:text-sm">
                <div>
                  <span className="font-bold uppercase tracking-wider text-rose-800">Account Frozen:</span> Your
                  account is currently frozen by compliance. You can still receive money, but outgoing transfers are disabled.
                </div>
              </div>
            )}
            {children}
          </main>
        </div>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-surface-container-lowest border-t border-outline-variant flex items-center justify-around py-2 px-1 shadow-lg">
        {bottomNavItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded text-[10px] font-semibold transition-colors ${
                isActive ? 'text-primary' : 'text-on-surface-variant'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Global Step-Up Authentication Modal */}
      <StepUpModal />
    </div>
  );
}
