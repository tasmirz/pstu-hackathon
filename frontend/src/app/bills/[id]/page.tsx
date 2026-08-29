'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { Modal } from '@/components/common/Modal';
import { StepUpModal } from '@/components/common/StepUpModal';
import { useAuth } from '@/lib/auth-context';
import { formatPaisa, formatDate } from '@/lib/money';
import { getIdempotencyKey, clearIdempotencyKey } from '@/lib/idempotency';
import { api } from '@/lib/api';
import { Bill } from '@/lib/types';
import {
  Users,
  ArrowLeft,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  ShieldCheck,
  Ban,
  Lock,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';
import confetti from 'canvas-confetti';

export default function BillDetailPage() {
  const params = useParams();
  const router = useRouter();
  const billId = Number(params.id);

  const { user, balance, refreshBalance, requestStepUp } = useAuth();
  const [bill, setBill] = useState<Bill | null>(null);
  const [loading, setLoading] = useState(true);

  // Pay Share Modal State
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpReason, setStepUpReason] = useState('HIGH_VALUE_TRANSFER');
  const [stepUpToken, setStepUpToken] = useState<string | null>(null);

  // Cancel Bill State
  const [cancelling, setCancelling] = useState(false);

  const fetchBill = async () => {
    try {
      const data = await api.getBill(billId);
      setBill(data);
    } catch (err) {
      console.error('Failed to load bill', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (billId) fetchBill();
  }, [billId]);

  if (loading) {
    return <div className="p-12 text-center text-xs text-on-surface-variant">Loading shared bill...</div>;
  }

  if (!bill) {
    return (
      <div className="p-12 text-center space-y-4">
        <p className="text-sm font-semibold text-error">Shared bill not found</p>
        <Link href="/bills">
          <Button variant="secondary" size="sm">
            Back to Bills
          </Button>
        </Link>
      </div>
    );
  }

  const myShare = user ? bill.shares.find((s) => s.payer.id === user.id) : null;
  const isCreator = user ? bill.created_by.id === user.id : false;
  const paidCount = bill.shares.filter((s) => s.state === 'PAID').length;
  const totalCount = bill.shares.length;

  const handlePayMyShare = async () => {
    if (!bill || !myShare || !user) return;
    setPaying(true);
    setPayError(null);

    const idempotencyKey = getIdempotencyKey(`bill-pay-${bill.id}`);

    try {
      const res = await api.payBillShare(user.id, bill.id, idempotencyKey, stepUpToken || undefined);
      clearIdempotencyKey(`bill-pay-${bill.id}`);
      await refreshBalance();
      setPayModalOpen(false);

      confetti({ particleCount: 60, spread: 60, origin: { y: 0.6 } });
      await fetchBill();
    } catch (err: any) {
      if (err.status === 403 && err.error === 'STEP_UP_REQUIRED') {
        const reason = err.details?.reason || 'SECURITY_CHALLENGE';
        try {
          const suToken = await requestStepUp(reason);
          setStepUpToken(suToken);
          // Retry automatically with the token
          await api.payBillShare(user.id, bill.id, idempotencyKey, suToken || undefined);
          clearIdempotencyKey(`bill-pay-${bill.id}`);
          await refreshBalance();
          setPayModalOpen(false);
          confetti({ particleCount: 60, spread: 60, origin: { y: 0.6 } });
          await fetchBill();
        } catch {
          setPayError('Step-up verification failed or cancelled');
        }
      } else if (err.status === 402) {
        setPayError(`Not enough balance. You have ${formatPaisa(balance)}.`);
      } else {
        setPayError(err.message || 'Payment failed');
      }
    } finally {
      setPaying(false);
    }
  };

  const handleCancelBill = async () => {
    if (!user || !isCreator) return;
    if (!confirm('Are you sure you want to cancel this shared bill?')) return;
    setCancelling(true);
    try {
      await api.cancelBill(user.id, bill.id);
      await fetchBill();
    } catch (err: any) {
      alert(err.message || 'Failed to cancel bill');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 pb-2 border-b border-outline-variant">
        <Link href="/bills">
          <Button variant="ghost" size="sm" leftIcon={<ArrowLeft className="w-4 h-4" />}>
            Back to Bills
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-on-surface">{bill.title}</h1>
          <p className="text-xs text-on-surface-variant">
            Shared Bill Status Board · Ref: <span className="font-mono">{bill.ref}</span>
          </p>
        </div>
      </div>

      {/* Overview Card */}
      <Card className="p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-outline-variant">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-on-surface">{bill.title}</h2>
              <Badge variant={bill.state === 'SETTLED' ? 'success' : bill.state === 'CANCELLED' ? 'error' : 'neutral'}>
                {bill.state}
              </Badge>
            </div>
            <p className="text-xs text-on-surface-variant mt-1">
              Created by <strong>{isCreator ? 'You' : bill.created_by.name}</strong> · {formatDate(bill.created_at)}
            </p>
          </div>

          <div className="text-left sm:text-right">
            <span className="text-[11px] uppercase font-bold text-outline block">Total Bill</span>
            <span className="font-mono-data text-2xl font-bold text-primary">
              {formatPaisa(bill.total_amount_paisa)}
            </span>
          </div>
        </div>

        {/* Progress summary */}
        <div className="flex items-center justify-between text-xs font-semibold text-on-surface-variant">
          <span>Settlement Progress</span>
          <span className="font-mono">{paidCount} of {totalCount} shares settled</span>
        </div>
        <div className="w-full bg-surface-container h-2 rounded-full overflow-hidden">
          <div
            className="bg-primary h-full rounded-full transition-all duration-500"
            style={{ width: `${(paidCount / totalCount) * 100}%` }}
          />
        </div>
      </Card>

      {/* Prominent "Pay my share" banner if current user has a pending share */}
      {myShare && myShare.state === 'PENDING' && bill.state === 'OPEN' && (
        <Card className="p-5 bg-primary-fixed border border-primary text-primary flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm animate-in fade-in">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <h3 className="font-bold text-base text-primary">You owe {formatPaisa(myShare.amount_paisa)}</h3>
            </div>
            <p className="text-xs text-primary/80 mt-1">
              Pay your share directly to {bill.created_by.name} from your ordinary account balance.
            </p>
          </div>

          <Button
            variant="primary"
            size="lg"
            onClick={() => setPayModalOpen(true)}
            className="font-bold text-xs shrink-0 py-3 px-6"
          >
            Pay My Share
          </Button>
        </Card>
      )}

      {/* Shares List / Status Board */}
      <Card className="p-0 overflow-hidden divide-y divide-outline-variant">
        <div className="p-4 bg-surface-container-low text-xs font-bold text-on-surface uppercase tracking-wider">
          Individual Participant Shares
        </div>

        {bill.shares.map((share) => (
          <div
            key={share.id}
            className="p-4 flex items-center justify-between gap-4 hover:bg-surface-container-low transition-colors"
          >
            <div className="flex items-center gap-3">
              {share.state === 'PAID' ? (
                <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
              ) : share.state === 'CANCELLED' ? (
                <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                  <Ban className="w-4 h-4" />
                </div>
              ) : (
                <div className="w-7 h-7 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                  <Clock className="w-4 h-4" />
                </div>
              )}

              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-on-surface">{share.payer.name}</span>
                  {share.payer.id === user?.id && (
                    <span className="text-[10px] bg-surface-container px-1.5 py-0.5 rounded font-semibold text-primary">
                      You
                    </span>
                  )}
                </div>
                <span className="text-xs text-on-surface-variant font-mono">{share.payer.phone}</span>
              </div>
            </div>

            <div className="text-right">
              <span className="font-mono-data font-bold text-sm text-on-surface block">
                {formatPaisa(share.amount_paisa)}
              </span>

              <div className="flex items-center justify-end gap-2 mt-1">
                <Badge variant={share.state === 'PAID' ? 'success' : share.state === 'CANCELLED' ? 'error' : 'neutral'}>
                  {share.state}
                </Badge>

                {share.settled_txn_id && (
                  <Link
                    href={`/transactions/${share.settled_txn_id}`}
                    className="text-[11px] text-primary hover:underline font-semibold flex items-center gap-0.5"
                  >
                    <span>Txn</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
            </div>
          </div>
        ))}
      </Card>

      {/* Creator Actions: Cancel Bill */}
      {isCreator && bill.state === 'OPEN' && (
        <div className="flex justify-end pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCancelBill}
            isLoading={cancelling}
            className="text-xs text-error border-error/30 hover:bg-rose-50"
          >
            Cancel Bill
          </Button>
        </div>
      )}

      {/* PAY SHARE CONFIRMATION MODAL (§11 / Step 2) */}
      {payModalOpen && myShare && (
        <Modal isOpen={true} onClose={() => setPayModalOpen(false)} title="Confirm Share Settlement">
          <div className="space-y-4 text-xs">
            <div className="p-4 rounded-lg bg-surface-container-low border border-outline-variant space-y-2 text-center">
              <span className="text-outline uppercase text-[10px] font-bold block">You are paying</span>
              <span className="font-mono-data text-3xl font-bold text-primary block">
                {formatPaisa(myShare.amount_paisa)}
              </span>
              <p className="text-on-surface-variant">
                To <strong>{bill.created_by.name}</strong> for <em>"{bill.title}"</em>
              </p>
            </div>

            <div className="p-3 rounded bg-surface-container-lowest border border-outline-variant flex items-center justify-between text-on-surface-variant">
              <span>Your available balance:</span>
              <span className="font-mono font-bold text-on-surface">
                {formatPaisa(balance)}
              </span>
            </div>

            {payError && (
              <div className="p-3 rounded bg-rose-50 border border-rose-200 text-rose-900 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{payError}</span>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button variant="secondary" onClick={() => setPayModalOpen(false)} className="flex-1">
                Cancel
              </Button>
              <Button
                variant="primary"
                isLoading={paying}
                onClick={handlePayMyShare}
                className="flex-1 font-bold"
              >
                Confirm & Pay
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
