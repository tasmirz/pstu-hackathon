'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { Modal } from '@/components/common/Modal';
import { formatPaisa, formatDate } from '@/lib/money';
import { api } from '@/lib/api';
import { Dispute } from '@/lib/types';
import {
  ShieldAlert,
  RotateCcw,
  XCircle,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  FileText,
} from 'lucide-react';

export default function AdminDisputesPage() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [tab, setTab] = useState<'open' | 'resolved'>('open');
  const [loading, setLoading] = useState(false);

  // Resolution Modal State
  const [selectedDispute, setSelectedDispute] = useState<Dispute | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [resolvingAction, setResolvingAction] = useState<'REVERSE' | 'REJECT' | null>(null);
  const [resolveLoading, setResolveLoading] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const fetchDisputes = async () => {
    setLoading(true);
    try {
      const res = await api.getAdminDisputes();
      setDisputes(Array.isArray(res) ? res : (res.items ?? []));
    } catch (err) {
      console.error('Failed to load disputes', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDisputes();
  }, []);

  const handleOpenResolve = (dispute: Dispute, action: 'REVERSE' | 'REJECT') => {
    setSelectedDispute(dispute);
    setResolvingAction(action);
    setResolutionNote(
      action === 'REVERSE'
        ? 'Confirmed wrong recipient details. Funds returned to original sender.'
        : 'Investigation showed legitimate transfer. Dispute rejected.'
    );
    setResolveError(null);
  };

  const handleExecuteResolution = async () => {
    if (!selectedDispute || !resolvingAction || !resolutionNote.trim()) return;

    setResolveLoading(true);
    setResolveError(null);

    try {
      await api.resolveDispute(selectedDispute.id, resolvingAction, resolutionNote);
      setSelectedDispute(null);
      await fetchDisputes();
    } catch (err: any) {
      setResolveError(err.message || 'Failed to resolve dispute');
      // Refresh to update attempt counts
      await fetchDisputes();
    } finally {
      setResolveLoading(false);
    }
  };

  const openDisputes = disputes.filter((d) => d.state === 'OPEN');
  const resolvedDisputes = disputes.filter((d) => d.state !== 'OPEN');

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-outline-variant">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-100 text-amber-900 flex items-center justify-center">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-on-surface">Admin Dispute Queue</h1>
            <p className="text-xs text-on-surface-variant">
              Adjudicate contested transfers & execute compensating ledger reversals
            </p>
          </div>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={fetchDisputes}
          leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
        >
          Refresh Queue
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex p-1 bg-surface-container-low rounded border border-outline-variant w-full sm:w-72">
        <button
          onClick={() => setTab('open')}
          className={`flex-1 py-1.5 text-xs font-semibold rounded uppercase tracking-wider transition-colors ${
            tab === 'open' ? 'bg-primary text-white shadow-xs' : 'text-on-surface-variant'
          }`}
        >
          Open ({openDisputes.length})
        </button>
        <button
          onClick={() => setTab('resolved')}
          className={`flex-1 py-1.5 text-xs font-semibold rounded uppercase tracking-wider transition-colors ${
            tab === 'resolved' ? 'bg-primary text-white shadow-xs' : 'text-on-surface-variant'
          }`}
        >
          Resolved ({resolvedDisputes.length})
        </button>
      </div>

      {/* --- OPEN DISPUTES LIST --- */}
      {tab === 'open' && (
        <Card className="p-0 overflow-hidden divide-y divide-outline-variant">
          {openDisputes.length === 0 ? (
            <div className="p-12 text-center text-xs text-on-surface-variant">No open disputes in queue</div>
          ) : (
            openDisputes.map((dispute) => (
              <div key={dispute.id} className="p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 hover:bg-surface-container-low transition-colors">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-outline">#{dispute.id}</span>
                    <span className="font-bold text-sm text-on-surface">
                      {dispute.raised_by?.name} ({dispute.raised_by?.role})
                    </span>
                    <span className="text-xs text-on-surface-variant">disputes</span>
                    <span className="font-mono-data font-bold text-sm text-primary">
                      {formatPaisa(dispute.transaction?.amount_paisa)}
                    </span>
                  </div>

                  <p className="text-xs italic text-on-surface font-medium">"{dispute.reason}"</p>

                  <div className="flex items-center gap-3 text-[11px] text-on-surface-variant pt-1">
                    <span className="font-mono">{dispute.transaction?.ref}</span>
                    <span>→ {dispute.counterparty?.name}</span>
                    <span>· Raised {formatDate(dispute.created_at)}</span>
                  </div>

                  {/* Advisory Reversibility Indicator */}
                  <div className="flex items-center gap-3 pt-1">
                    {dispute.reversible_now ? (
                      <span className="text-[11px] font-semibold text-emerald-800 flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-600 inline-block" />
                        <span>Reversible now (receiver balance sufficient)</span>
                      </span>
                    ) : (
                      <span className="text-[11px] font-semibold text-amber-900 flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-amber-600 inline-block" />
                        <span>Not reversible right now (receiver balance insufficient)</span>
                      </span>
                    )}

                    {dispute.attempts && dispute.attempts > 0 ? (
                      <span className="text-[11px] text-rose-800 font-semibold bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                        ⚠ {dispute.attempts} failed attempt: {dispute.last_attempt_error}
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0 w-full md:w-auto justify-end">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleOpenResolve(dispute, 'REJECT')}
                    className="text-xs"
                  >
                    Reject
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleOpenResolve(dispute, 'REVERSE')}
                    className="text-xs font-bold"
                  >
                    Reverse Transfer
                  </Button>
                </div>
              </div>
            ))
          )}
        </Card>
      )}

      {/* --- RESOLVED DISPUTES LIST --- */}
      {tab === 'resolved' && (
        <Card className="p-0 overflow-hidden divide-y divide-outline-variant">
          {resolvedDisputes.length === 0 ? (
            <div className="p-12 text-center text-xs text-on-surface-variant">No resolved disputes</div>
          ) : (
            resolvedDisputes.map((dispute) => (
              <div key={dispute.id} className="p-5 opacity-80 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-outline">#{dispute.id}</span>
                    <span className="font-bold text-sm text-on-surface">{dispute.raised_by?.name}</span>
                    <span className="font-mono-data font-bold text-xs text-on-surface">
                      {formatPaisa(dispute.transaction?.amount_paisa)}
                    </span>
                  </div>
                  <Badge variant={dispute.state === 'REVERSED' ? 'success' : 'error'}>
                    {dispute.state}
                  </Badge>
                </div>
                <p className="text-xs text-on-surface-variant">
                  <strong>Resolution note:</strong> "{dispute.resolution}"
                </p>
                <p className="text-[10px] text-outline">
                  Resolved {formatDate(dispute.resolved_at)}
                </p>
              </div>
            ))
          )}
        </Card>
      )}

      {/* RESOLUTION MODAL */}
      {selectedDispute && resolvingAction && (
        <Modal
          isOpen={true}
          onClose={() => setSelectedDispute(null)}
          title={resolvingAction === 'REVERSE' ? 'Execute Dispute Reversal' : 'Reject Dispute'}
        >
          <div className="space-y-4 text-xs">
            <div className="p-3 rounded bg-surface-container-low border border-outline-variant">
              <p className="font-bold text-on-surface">Dispute #{selectedDispute.id}</p>
              <p className="text-on-surface-variant">
                {selectedDispute.raised_by?.name} claims:{' '}
                <strong>"{selectedDispute.reason}"</strong>
              </p>
              <p className="text-primary font-mono-data font-bold mt-1">
                Amount: {formatPaisa(selectedDispute.transaction?.amount_paisa)}
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
                Mandatory Resolution Audit Note
              </label>
              <textarea
                rows={3}
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
                placeholder="Explain the justification for this administrative decision..."
                className="w-full p-2.5 rounded bg-surface-container-lowest border border-outline-variant text-on-surface text-xs focus:outline-none focus:border-primary"
                required
              />
            </div>

            {resolveError && (
              <div className="p-3 rounded bg-rose-50 border border-rose-200 text-rose-900 space-y-1">
                <p className="font-bold">Reversal Blocked by Ledger Invariant</p>
                <p>{resolveError}</p>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button variant="secondary" onClick={() => setSelectedDispute(null)} className="flex-1">
                Cancel
              </Button>
              <Button
                variant={resolvingAction === 'REVERSE' ? 'primary' : 'danger'}
                isLoading={resolveLoading}
                disabled={!resolutionNote.trim()}
                onClick={handleExecuteResolution}
                className="flex-1 font-bold"
              >
                Confirm {resolvingAction === 'REVERSE' ? 'Reversal' : 'Rejection'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
