'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { useAuth } from '@/lib/auth-context';
import { formatPaisa, formatDate, timeAgo } from '@/lib/money';
import { api } from '@/lib/api';
import { Transaction, MoneyRequest } from '@/lib/types';
import {
  Send,
  ArrowDownLeft,
  ArrowUpRight,
  RotateCcw,
  Timer,
  Info,
  ChevronRight,
  ShieldCheck,
  AlertCircle,
  Sliders,
  AlertOctagon,
} from 'lucide-react';

export default function DashboardPage() {
  const router = useRouter();
  const { user, balance, heldBalance, availableBalance, balanceUpdated, refreshBalance } = useAuth();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<MoneyRequest[]>([]);
  const [heldTxn, setHeldTxn] = useState<Transaction | null>(null);
  const [countdownSeconds, setCountdownSeconds] = useState<number>(0);
  const [cancellingHold, setCancellingHold] = useState<boolean>(false);
  const [holdError, setHoldError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;

    const loadData = async () => {
      try {
        const txnsRes = await api.getTransactions(user.id, 5);
        setTransactions(txnsRes.items);

        // Check for active HELD transaction for undo bar
        const activeHeld = txnsRes.items.find((t) => t.state === 'HELD' && t.settle_after);
        if (activeHeld) {
          setHeldTxn(activeHeld);
          const remaining = Math.max(
            0,
            Math.floor((new Date(activeHeld.settle_after!).getTime() - Date.now()) / 1000)
          );
          setCountdownSeconds(remaining);
        } else {
          setHeldTxn(null);
        }

        // Incoming requests
        const reqs = await api.getMoneyRequests(user.id, 'incoming');
        setIncomingRequests(reqs.filter((r) => r.state === 'PENDING').slice(0, 2));
      } catch (err) {
        console.error('Failed to load dashboard data', err);
      }
    };

    loadData();
    const interval = setInterval(loadData, 2000);
    return () => clearInterval(interval);
  }, [user]);

  // Tick countdown for held transfer
  useEffect(() => {
    if (!heldTxn || countdownSeconds <= 0) return;
    const timer = setInterval(() => {
      setCountdownSeconds((prev) => {
        if (prev <= 1) {
          setHeldTxn(null);
          refreshBalance();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [heldTxn, countdownSeconds, refreshBalance]);

  const handleUndoHeld = async () => {
    if (!heldTxn || !user) return;
    setCancellingHold(true);
    setHoldError(null);
    try {
      await api.cancelHoldTransfer(user.id, heldTxn.id);
      setHeldTxn(null);
      await refreshBalance();
      // Reload recent transactions
      const txnsRes = await api.getTransactions(user.id, 5);
      setTransactions(txnsRes.items);
    } catch (err: any) {
      setHoldError(err.message || 'Too late — that already sent.');
    } finally {
      setCancellingHold(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Greeting & Live Balance */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-2">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-on-surface">
            Hi, {user?.name ? user.name.split(' ')[0] : 'Rahim'}
          </h2>
          <div className="flex items-baseline gap-3 mt-1">
            <span
              className={`font-mono-data text-3xl sm:text-4xl md:text-5xl font-bold text-primary tracking-tight transition-all rounded px-2 py-1 -ml-2 ${
                balanceUpdated ? 'bg-primary-fixed text-primary glow-update scale-102' : ''
              }`}
            >
              {formatPaisa(balance)}
            </span>
          </div>

          {/* Held Paisa indicator */}
          {heldBalance > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-2.5 py-1 mt-2 inline-flex">
              <Info className="w-3.5 h-3.5 text-amber-700" />
              <span className="font-semibold">{formatPaisa(heldBalance)} held</span>
              <span className="text-on-surface-variant">— pending delayed settlement</span>
            </div>
          )}
        </div>

        {/* Two Big Primary Action Buttons */}
        <div className="flex items-center gap-3 w-full md:w-auto">
          <Link href="/send" className="flex-1 md:flex-none">
            <Button
              variant="primary"
              size="lg"
              leftIcon={<Send className="w-4 h-4" />}
              className="w-full md:w-44 py-3.5 font-bold"
              disabled={user?.status === 'FROZEN'}
            >
              Send Money
            </Button>
          </Link>
          <Link href="/requests" className="flex-1 md:flex-none">
            <Button
              variant="secondary"
              size="lg"
              leftIcon={<ArrowDownLeft className="w-4 h-4" />}
              className="w-full md:w-44 py-3.5 font-bold"
            >
              Request
            </Button>
          </Link>
          <Link href="/disputes" className="flex-1 md:flex-none">
            <Button
              variant="outline"
              size="lg"
              leftIcon={<AlertOctagon className="w-4 h-4" />}
              className="w-full md:w-44 py-3.5 font-bold"
            >
              Raise Dispute
            </Button>
          </Link>
        </div>
      </header>

      {/* Undo Bar (P1) — Only visible while transfer is HELD */}
      {heldTxn && (
        <div className="p-4 rounded-lg bg-surface-container-highest border border-primary-fixed-dim flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-3 text-primary">
            <div className="w-8 h-8 rounded-full bg-primary-fixed text-primary flex items-center justify-center animate-pulse shrink-0">
              <Timer className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs sm:text-sm font-bold text-on-surface">
                ⏱ {formatPaisa(heldTxn.amount_paisa)} to {heldTxn.counterparty?.name || 'Recipient'} · {countdownSeconds}s to cancel
              </p>
              <p className="text-[11px] text-on-surface-variant">
                Held transfer above ৳5,000 threshold. Money will settle automatically once timer expires.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            isLoading={cancellingHold}
            onClick={handleUndoHeld}
            className="w-full sm:w-auto border-primary text-primary hover:bg-primary-fixed font-bold shrink-0"
          >
            Undo Transfer
          </Button>
        </div>
      )}

      {holdError && (
        <div className="p-3 rounded bg-rose-50 border border-rose-200 text-xs text-rose-900 font-medium">
          {holdError}
        </div>
      )}

      {/* Daily Limits & Velocity Summary Bar (P1) */}
      <Card className="p-4 bg-surface-container-low flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Sliders className="w-4 h-4 text-primary shrink-0" />
          <span className="text-xs font-semibold text-on-surface">
            ৳4,750.00 of ৳50,000.00 daily limit left
          </span>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="w-full sm:w-48 bg-surface-container-highest h-2 rounded-full overflow-hidden">
            <div className="bg-primary h-full rounded-full w-[95%]" />
          </div>
          <Link href="/limits" className="text-xs font-semibold text-primary hover:underline shrink-0">
            Details →
          </Link>
        </div>
      </Card>

      {/* Bento Grid: Recent Activity & Action Hub */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Recent Activity (Spans 8 cols on desktop) */}
        <section className="lg:col-span-8 bg-surface-container-lowest border border-outline-variant rounded-lg p-5">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-outline-variant">
            <h3 className="text-base font-bold text-on-surface">Recent Activity</h3>
            <Link href="/history" className="text-xs font-semibold text-primary hover:underline flex items-center gap-1">
              <span>See all</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="divide-y divide-outline-variant">
            {transactions.length === 0 ? (
              <p className="text-xs text-on-surface-variant py-8 text-center">No transactions yet</p>
            ) : (
              transactions.map((txn) => {
                const isSent = txn.entries?.[0]?.amount_paisa ? txn.entries[0].amount_paisa < 0 : true;
                const isReversal = txn.kind === 'REVERSAL';

                return (
                  <Link
                    key={txn.id}
                    href={`/transactions/${txn.id}`}
                    className="flex items-center justify-between py-3.5 px-2 hover:bg-surface-container-low transition-colors rounded -mx-2 group"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                          isReversal
                            ? 'bg-amber-100 text-amber-900'
                            : isSent
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {isReversal ? (
                          <RotateCcw className="w-4 h-4" />
                        ) : isSent ? (
                          <ArrowUpRight className="w-4 h-4" />
                        ) : (
                          <ArrowDownLeft className="w-4 h-4" />
                        )}
                      </div>
                      <div>
                        <p className="text-xs sm:text-sm font-semibold text-on-surface group-hover:text-primary transition-colors">
                          {isReversal
                            ? txn.note || 'Reversed Transaction'
                            : isSent
                            ? `Sent to ${txn.counterparty?.name || 'User'}`
                            : `Received from ${txn.counterparty?.name || 'User'}`}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] text-on-surface-variant">{timeAgo(txn.created_at)}</span>
                          <span className="text-[10px] text-outline uppercase font-mono">· {txn.kind}</span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <p
                        className={`font-mono-data text-xs sm:text-sm font-bold ${
                          isReversal ? 'text-amber-800' : isSent ? 'text-on-surface' : 'text-emerald-700'
                        }`}
                      >
                        {isSent && !isReversal ? `−${formatPaisa(txn.amount_paisa)}` : `+${formatPaisa(txn.amount_paisa)}`}
                      </p>
                      <div className="mt-0.5">
                        <Badge
                          variant={
                            txn.state === 'COMPLETED'
                              ? 'success'
                              : txn.state === 'HELD'
                              ? 'held'
                              : txn.state === 'REVERSED'
                              ? 'warning'
                              : 'neutral'
                          }
                        >
                          {txn.state}
                        </Badge>
                      </div>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </section>

        {/* Side Hub: Money Requests & Quick Proof (4 cols) */}
        <section className="lg:col-span-4 space-y-6">
          {/* Pending Money Requests Card */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-lg p-5">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-outline-variant">
              <h3 className="text-sm font-bold text-on-surface">Incoming Requests</h3>
              <Link href="/requests" className="text-xs font-semibold text-primary hover:underline">
                View all
              </Link>
            </div>

            {incomingRequests.length === 0 ? (
              <p className="text-xs text-on-surface-variant py-4 text-center">No pending requests</p>
            ) : (
              <div className="space-y-3">
                {incomingRequests.map((req) => (
                  <div key={req.id} className="p-3 rounded bg-surface-container-low border border-outline-variant text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-bold text-on-surface">{req.requester?.name}</p>
                        <p className="text-[11px] text-on-surface-variant">{req.note || 'Money request'}</p>
                      </div>
                      <span className="font-mono-data font-bold text-primary text-xs">
                        {formatPaisa(req.amount_paisa)}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <Link href={`/send?to=${encodeURIComponent(req.requester?.phone || '')}&amount=${req.amount_paisa / 100}&reqId=${req.id}`} className="flex-1">
                        <Button variant="primary" size="sm" className="w-full text-xs py-1">
                          Pay
                        </Button>
                      </Link>
                      <Link href="/requests" className="flex-1">
                        <Button variant="secondary" size="sm" className="w-full text-xs py-1">
                          View
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick Ledger Invariant Callout */}
          <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-300 text-emerald-950 space-y-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-700" />
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-900">
                Ledger Conservation Active
              </span>
            </div>
            <p className="text-xs text-emerald-900 leading-relaxed">
              Every single transfer enforces strict double-entry balance equality (<code className="font-mono font-bold">Sum: ৳0.00</code>).
            </p>
            <Link
              href="/integrity"
              className="inline-block text-xs font-bold text-emerald-800 underline hover:text-emerald-950 pt-1"
            >
              Inspect Live Integrity Verification →
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
