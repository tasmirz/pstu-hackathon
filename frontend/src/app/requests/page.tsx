'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Badge } from '@/components/common/Badge';
import { useAuth } from '@/lib/auth-context';
import { formatPaisa, parseToPaisa, formatDate } from '@/lib/money';
import { api } from '@/lib/api';
import { MoneyRequest } from '@/lib/types';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Send,
  CheckCircle2,
  XCircle,
  Clock,
  UserCheck,
  UserX,
  Plus,
  RefreshCw,
} from 'lucide-react';

export default function MoneyRequestsPage() {
  const { user, refreshBalance } = useAuth();
  const [tab, setTab] = useState<'inbox' | 'outbox' | 'create' | 'history'>('inbox');

  const [incoming, setIncoming] = useState<MoneyRequest[]>([]);
  const [outgoing, setOutgoing] = useState<MoneyRequest[]>([]);
  const [loading, setLoading] = useState(false);

  // Create Form State
  const [phone, setPhone] = useState('+8801733445566');
  const [amountStr, setAmountStr] = useState('1200');
  const [note, setNote] = useState('for the ticket');
  const [recipient, setRecipient] = useState<{ id: number; name: string; phone: string } | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);

  const fetchRequests = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const inc = await api.getMoneyRequests(user.id, 'incoming');
      const out = await api.getMoneyRequests(user.id, 'outgoing');
      setIncoming(inc);
      setOutgoing(out);
    } catch (err) {
      console.error('Failed to load money requests', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, [user]);

  // Phone lookup for Create tab
  useEffect(() => {
    if (!phone || phone.length < 8) {
      setRecipient(null);
      setLookupError(null);
      return;
    }
    setLookupLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await api.lookupUser(phone);
        setRecipient(data);
        setLookupError(null);
      } catch {
        setRecipient(null);
        setLookupError('No user found');
      } finally {
        setLookupLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [phone]);

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !recipient) return;
    const amountPaisa = parseToPaisa(amountStr);
    if (amountPaisa <= 0) return;

    setCreateLoading(true);
    try {
      await api.createMoneyRequest(user.id, recipient.phone, amountPaisa, note);
      setCreateSuccess(true);
      await fetchRequests();
      setTimeout(() => {
        setCreateSuccess(false);
        setTab('outbox');
      }, 1200);
    } catch (err: any) {
      alert(err.message || 'Failed to create request');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleDecline = async (reqId: number) => {
    if (!user) return;
    try {
      await api.declineMoneyRequest(user.id, reqId);
      await fetchRequests();
    } catch (err: any) {
      alert(err.message || 'Failed to decline request');
    }
  };

  const handleCancel = async (reqId: number) => {
    if (!user) return;
    try {
      await api.cancelMoneyRequest(user.id, reqId);
      await fetchRequests();
    } catch (err: any) {
      alert(err.message || 'Failed to cancel request');
    }
  };

  const pendingIncoming = incoming.filter((r) => r.state === 'PENDING');
  const pendingOutgoing = outgoing.filter((r) => r.state === 'PENDING');
  const historyList = [...incoming, ...outgoing].filter((r) => r.state !== 'PENDING');

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-on-surface">Money Requests Hub</h1>
          <p className="text-xs text-on-surface-variant">
            Collect money from friends or manage incoming payment requests
          </p>
        </div>

        <Button
          variant="primary"
          size="sm"
          onClick={() => setTab('create')}
          leftIcon={<Plus className="w-4 h-4" />}
          className="font-bold text-xs"
        >
          New Money Request
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex p-1 bg-surface-container-low rounded border border-outline-variant">
        {[
          { key: 'inbox', label: `Incoming (${pendingIncoming.length})` },
          { key: 'outbox', label: `Outgoing (${pendingOutgoing.length})` },
          { key: 'create', label: 'Create Request' },
          { key: 'history', label: `History (${historyList.length})` },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as any)}
            className={`flex-1 py-2 text-xs font-semibold rounded uppercase tracking-wider transition-colors ${
              tab === t.key
                ? 'bg-primary text-white shadow-xs'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* --- INBOX TAB --- */}
      {tab === 'inbox' && (
        <Card className="p-0 overflow-hidden divide-y divide-outline-variant">
          {pendingIncoming.length === 0 ? (
            <div className="p-12 text-center text-xs text-on-surface-variant">No pending incoming requests</div>
          ) : (
            pendingIncoming.map((req) => (
              <div key={req.id} className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:bg-surface-container-low transition-colors">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-on-surface">{req.requester?.name}</span>
                    <span className="text-xs text-on-surface-variant font-mono">({req.requester?.phone})</span>
                  </div>
                  <p className="text-xs text-on-surface-variant mt-1">"{req.note || 'No note'}"</p>
                  <span className="text-[11px] text-outline flex items-center gap-1 mt-1">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Expires {formatDate(req.expires_at)}</span>
                  </span>
                </div>

                <div className="flex sm:flex-col items-end gap-3 w-full sm:w-auto justify-between sm:justify-start">
                  <span className="font-mono-data font-bold text-base text-primary">
                    {formatPaisa(req.amount_paisa)}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleDecline(req.id)}
                      className="text-xs py-1 px-3"
                    >
                      Decline
                    </Button>
                    <Link
                      href={`/send?to=${encodeURIComponent(req.requester?.phone || '')}&amount=${req.amount_paisa / 100}&reqId=${req.id}`}
                    >
                      <Button variant="primary" size="sm" className="text-xs py-1 px-4 font-bold">
                        Pay Request
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            ))
          )}
        </Card>
      )}

      {/* --- OUTBOX TAB --- */}
      {tab === 'outbox' && (
        <Card className="p-0 overflow-hidden divide-y divide-outline-variant">
          {pendingOutgoing.length === 0 ? (
            <div className="p-12 text-center text-xs text-on-surface-variant">No pending outgoing requests</div>
          ) : (
            pendingOutgoing.map((req) => (
              <div key={req.id} className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-on-surface">To: {req.payer?.name}</span>
                    <span className="text-xs text-on-surface-variant font-mono">({req.payer?.phone})</span>
                  </div>
                  <p className="text-xs text-on-surface-variant mt-1">"{req.note || 'No note'}"</p>
                  <span className="text-[11px] text-outline flex items-center gap-1 mt-1">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Requested {formatDate(req.created_at)}</span>
                  </span>
                </div>

                <div className="flex sm:flex-col items-end gap-3 w-full sm:w-auto justify-between sm:justify-start">
                  <span className="font-mono-data font-bold text-base text-on-surface">
                    {formatPaisa(req.amount_paisa)}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCancel(req.id)}
                    className="text-xs py-1 px-3"
                  >
                    Cancel Request
                  </Button>
                </div>
              </div>
            ))
          )}
        </Card>
      )}

      {/* --- CREATE REQUEST TAB --- */}
      {tab === 'create' && (
        <Card className="p-6">
          <form onSubmit={handleCreateRequest} className="space-y-4">
            <h3 className="text-sm font-bold text-on-surface uppercase tracking-wider pb-2 border-b border-outline-variant">
              Request Money from Contact
            </h3>

            <div className="space-y-1.5">
              <Input
                label="Request from (Phone Number)"
                type="tel"
                placeholder="+8801733445566"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                suffixElement={
                  lookupLoading ? (
                    <span className="text-xs text-outline animate-pulse">Checking...</span>
                  ) : recipient ? (
                    <UserCheck className="w-4 h-4 text-emerald-600" />
                  ) : lookupError ? (
                    <UserX className="w-4 h-4 text-error" />
                  ) : null
                }
              />
              {recipient && (
                <div className="p-2 rounded bg-surface-container-low border border-outline-variant flex items-center gap-2 text-xs">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span className="font-bold text-on-surface">{recipient.name}</span>
                  <span className="text-on-surface-variant font-mono">({recipient.phone})</span>
                </div>
              )}
            </div>

            <Input
              label="Amount in BDT (৳)"
              type="text"
              placeholder="0.00"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              prefixElement={<span className="font-bold text-primary">৳</span>}
              required
            />

            <Input
              label="Note for Payer"
              type="text"
              placeholder="e.g. for the ticket, shared dinner"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />

            {createSuccess && (
              <div className="p-3 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Request sent successfully! Moves to Outbox.</span>
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              isLoading={createLoading}
              disabled={!recipient || parseToPaisa(amountStr) <= 0}
              className="w-full font-bold py-3 mt-2"
            >
              Send Request
            </Button>
          </form>
        </Card>
      )}

      {/* --- HISTORY TAB --- */}
      {tab === 'history' && (
        <Card className="p-0 overflow-hidden divide-y divide-outline-variant">
          {historyList.length === 0 ? (
            <div className="p-12 text-center text-xs text-on-surface-variant">No historical requests</div>
          ) : (
            historyList.map((req) => (
              <div key={req.id} className="p-4 flex items-center justify-between opacity-75">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-on-surface">
                      {req.requester?.name} → {req.payer?.name}
                    </span>
                    <span className="text-[10px] text-outline font-mono">({req.note})</span>
                  </div>
                  <span className="text-[11px] text-on-surface-variant mt-0.5 block">
                    Created {formatDate(req.created_at)}
                  </span>
                </div>

                <div className="text-right">
                  <span className="font-mono-data font-semibold text-xs text-on-surface">
                    {formatPaisa(req.amount_paisa)}
                  </span>
                  <div className="mt-1">
                    <Badge
                      variant={
                        req.state === 'PAID'
                          ? 'success'
                          : req.state === 'DECLINED'
                          ? 'error'
                          : req.state === 'CANCELLED'
                          ? 'warning'
                          : 'neutral'
                      }
                    >
                      {req.state}
                    </Badge>
                  </div>
                </div>
              </div>
            ))
          )}
        </Card>
      )}
    </div>
  );
}
