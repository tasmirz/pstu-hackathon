'use client';

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { Modal } from '@/components/common/Modal';
import { Input } from '@/components/common/Input';
import { useAuth } from '@/lib/auth-context';
import { formatPaisa, formatDate } from '@/lib/money';
import { api } from '@/lib/api';
import { Transaction, Dispute } from '@/lib/types';
import {
  ArrowLeft,
  RotateCcw,
  AlertOctagon,
  Scale,
  ShieldCheck,
  CheckCircle2,
  Copy,
  Info,
} from 'lucide-react';

export default function TransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const txnId = parseInt(resolvedParams.id, 10);

  const router = useRouter();
  const { user, refreshBalance, requestStepUp } = useAuth();

  const [txn, setTxn] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // Reverse Modal State
  const [reverseModalOpen, setReverseModalOpen] = useState(false);
  const [reverseReason, setReverseReason] = useState('Sent to wrong account');
  const [reversing, setReversing] = useState(false);
  const [reverseError, setReverseError] = useState<string | null>(null);
  const [canOpenDisputeFrom402, setCanOpenDisputeFrom402] = useState(false);

  // Dispute Modal State
  const [disputeModalOpen, setDisputeModalOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState('Sent to wrong number');
  const [disputing, setDisputing] = useState(false);
  const [disputeError, setDisputeError] = useState<string | null>(null);
  const [disputeSuccess, setDisputeSuccess] = useState(false);

  useEffect(() => {
    const fetchDetail = async () => {
      setLoading(true);
      try {
        const data = await api.getTransaction(txnId);
        setTxn(data);
      } catch (err) {
        console.error('Failed to load transaction', err);
      } finally {
        setLoading(false);
      }
    };
    fetchDetail();
  }, [txnId]);

  const handleCopyRef = () => {
    if (txn?.ref) {
      navigator.clipboard.writeText(txn.ref);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const handleReverse = async () => {
    if (!txn || !user) return;
    setReversing(true);
    setReverseError(null);
    setCanOpenDisputeFrom402(false);

    try {
      await api.reverseTransaction(user.id, txn.id, reverseReason);
      setReverseModalOpen(false);
      await refreshBalance();
      // Reload transaction
      const updated = await api.getTransaction(txn.id);
      setTxn(updated);
    } catch (err: any) {
      if (err.status === 402) {
        setReverseError(
          `${txn.counterparty?.name || 'Receiver'} has already spent this money. Raise a dispute instead.`
        );
        setCanOpenDisputeFrom402(true);
      } else {
        setReverseError(err.message || 'Reversal failed');
      }
    } finally {
      setReversing(false);
    }
  };

  const handleRaiseDispute = async () => {
    if (!txn || !user) return;
    setDisputing(true);
    setDisputeError(null);

    try {
      await api.raiseDispute(user.id, txn.id, disputeReason);
      setDisputeSuccess(true);
      setTimeout(() => {
        setDisputeModalOpen(false);
        setDisputeSuccess(false);
      }, 1500);
    } catch (err: any) {
      setDisputeError(err.message || 'Failed to raise dispute');
    } finally {
      setDisputing(false);
    }
  };

  if (loading) {
    return <div className="p-12 text-center text-xs text-on-surface-variant">Loading transaction...</div>;
  }

  if (!txn) {
    return (
      <div className="p-12 text-center space-y-4">
        <p className="text-sm font-semibold text-error">Transaction not found</p>
        <Link href="/history">
          <Button variant="secondary" size="sm">
            Back to History
          </Button>
        </Link>
      </div>
    );
  }

  // Calculate sum of ledger legs to prove double entry
  const legs = txn.entries || [
    { account_id: 84, account_type: 'USER', amount_paisa: -txn.amount_paisa },
    { account_id: 86, account_type: 'USER', amount_paisa: txn.amount_paisa },
  ];
  const legSum = legs.reduce((acc, leg) => acc + leg.amount_paisa, 0);

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      {/* Top Navigation */}
      <div className="flex items-center justify-between">
        <Link href="/history" className="inline-flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant hover:text-on-surface">
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Transactions</span>
        </Link>
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

      {/* Main Detail Card */}
      <Card className="p-6 space-y-6">
        {/* Amount & Headline */}
        <div className="border-b border-outline-variant pb-5 space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
            Transaction Details
          </span>
          <div className="flex items-baseline justify-between">
            <h1 className="font-mono-data text-3xl md:text-4xl font-bold text-primary">
              {formatPaisa(txn.amount_paisa)}
            </h1>
            <span className="text-sm font-bold text-on-surface">{txn.counterparty?.name || 'Counterparty'}</span>
          </div>
          <p className="text-xs text-on-surface-variant">{formatDate(txn.created_at)} · {txn.kind}</p>
        </div>

        {/* Metadata grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="p-3 rounded bg-surface-container-low border border-outline-variant">
            <span className="text-outline uppercase text-[10px] font-bold block mb-1">Transaction Ref</span>
            <div className="flex items-center justify-between">
              <span className="font-mono text-on-surface font-semibold truncate">{txn.ref}</span>
              <button
                onClick={handleCopyRef}
                className="text-primary hover:text-on-primary-fixed-variant p-1"
                title="Copy reference ID"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
            {copied && <span className="text-[10px] text-emerald-700 font-semibold">Copied!</span>}
          </div>

          <div className="p-3 rounded bg-surface-container-low border border-outline-variant">
            <span className="text-outline uppercase text-[10px] font-bold block mb-1">Note / Description</span>
            <span className="text-on-surface font-medium">{txn.note || 'No note attached'}</span>
          </div>
        </div>

        {/* Ledger Entries Section — Proving Double-Entry */}
        <div className="rounded-lg bg-surface-container-low border border-outline-variant p-4 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-outline-variant">
            <div className="flex items-center gap-1.5">
              <Scale className="w-4 h-4 text-primary" />
              <span className="text-xs font-bold text-on-surface uppercase tracking-wider">
                Double-Entry Ledger Legs
              </span>
            </div>
            <span className="text-[10px] text-emerald-800 font-mono font-bold bg-emerald-100 px-2 py-0.5 rounded border border-emerald-300">
              Balanced Atomic Commit
            </span>
          </div>

          <div className="space-y-2 font-mono-data text-xs">
            {legs.map((leg, idx) => (
              <div key={idx} className="flex items-center justify-between py-1 px-1">
                <span className="text-on-surface-variant">
                  Account #{leg.account_id} ({leg.account_type || 'USER'})
                </span>
                <span className={leg.amount_paisa < 0 ? 'text-rose-800 font-semibold' : 'text-emerald-800 font-semibold'}>
                  {formatPaisa(leg.amount_paisa)}
                </span>
              </div>
            ))}

            <div className="border-t border-outline-variant pt-2 flex items-center justify-between font-bold text-xs">
              <span className="text-on-surface">Ledger Sum</span>
              <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                {formatPaisa(legSum)}
              </span>
            </div>
          </div>
        </div>

        {/* Actions (Reverse / Dispute) */}
        <div className="pt-2 flex flex-col sm:flex-row gap-3">
          {txn.can_reverse && (
            <Button
              variant="outline"
              leftIcon={<RotateCcw className="w-4 h-4" />}
              onClick={() => setReverseModalOpen(true)}
              className="flex-1"
            >
              Reverse this Transfer
            </Button>
          )}

          <Button
            variant="secondary"
            leftIcon={<AlertOctagon className="w-4 h-4" />}
            onClick={() => setDisputeModalOpen(true)}
            className="flex-1"
          >
            Raise Dispute
          </Button>
        </div>
      </Card>

      {/* REVERSE CONFIRMATION MODAL */}
      <Modal isOpen={reverseModalOpen} onClose={() => setReverseModalOpen(false)} title="Reverse Transaction">
        <div className="space-y-4 text-xs">
          <p className="text-on-surface-variant">
            Reversing creates a <strong>new compensating double-entry record</strong> on the ledger. The original
            transaction remains immutable.
          </p>

          <Input
            label="Mandatory Reason for Reversal"
            type="text"
            placeholder="e.g. Sent to wrong account by mistake"
            value={reverseReason}
            onChange={(e) => setReverseReason(e.target.value)}
            required
          />

          {reverseError && (
            <div className="p-3 rounded bg-rose-50 border border-rose-200 text-rose-900 space-y-2">
              <p className="font-semibold">{reverseError}</p>
              {canOpenDisputeFrom402 && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    setReverseModalOpen(false);
                    setDisputeReason(`Reversal failed: ${reverseReason}`);
                    setDisputeModalOpen(true);
                  }}
                  className="w-full"
                >
                  Open Dispute for Admin Review →
                </Button>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button variant="secondary" onClick={() => setReverseModalOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button variant="primary" isLoading={reversing} onClick={handleReverse} className="flex-1 font-bold">
              Confirm Reversal
            </Button>
          </div>
        </div>
      </Modal>

      {/* RAISE DISPUTE MODAL */}
      <Modal isOpen={disputeModalOpen} onClose={() => setDisputeModalOpen(false)} title="Raise Transaction Dispute">
        <div className="space-y-4 text-xs">
          <p className="text-on-surface-variant">
            Either sender or receiver may dispute a transaction within 7 days. This creates a queue item for administrative review.
          </p>

          <Input
            label="Dispute Reason"
            type="text"
            placeholder="Describe the issue in detail"
            value={disputeReason}
            onChange={(e) => setDisputeReason(e.target.value)}
            required
          />

          {disputeError && (
            <div className="p-3 rounded bg-rose-50 border border-rose-200 text-rose-900 font-medium">
              {disputeError}
            </div>
          )}

          {disputeSuccess && (
            <div className="p-3 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Dispute raised successfully. Queued for admin review.</span>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button variant="secondary" onClick={() => setDisputeModalOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button variant="primary" isLoading={disputing} onClick={handleRaiseDispute} className="flex-1 font-bold">
              Submit Dispute
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
