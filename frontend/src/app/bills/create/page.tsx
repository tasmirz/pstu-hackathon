'use client';

import React, { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { useAuth } from '@/lib/auth-context';
import { formatPaisa, parseToPaisa } from '@/lib/money';
import { api } from '@/lib/api';
import { PERSONAS } from '@/components/common/UserSwitcher';
import {
  ArrowLeft,
  Plus,
  Trash2,
  CheckCircle2,
  UserX,
  AlertTriangle,
  Users,
  Percent,
  Sliders,
  Sparkles,
} from 'lucide-react';

interface ParticipantRow {
  id: string;
  phone: string;
  amountStr: string;
  resolvedName?: string;
  reputation?: { score: number; tier: 'GOOD' | 'FAIR' | 'LOW' };
  lookupLoading?: boolean;
  lookupError?: string;
}

export default function CreateBillPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [title, setTitle] = useState('Dinner at Kacchi Bhai');
  const [splitMode, setSplitMode] = useState<'EQUAL' | 'CUSTOM'>('CUSTOM');
  const [totalAmountInput, setTotalAmountInput] = useState('800');

  const [rows, setRows] = useState<ParticipantRow[]>([
    { id: '1', phone: '+8801798765432', amountStr: '400', resolvedName: 'Karim Uddin', reputation: { score: 50, tier: 'FAIR' } },
    { id: '2', phone: '+8801755667788', amountStr: '400', resolvedName: 'Nadia Sultana', reputation: { score: 50, tier: 'FAIR' } },
  ]);

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Debounce timers for phone lookups
  const lookupTimers = useRef<Record<string, NodeJS.Timeout>>({});

  // Recalculate equal shares if in EQUAL mode
  const recalculateEqualShares = (participants: ParticipantRow[], totalStr: string) => {
    const totalPaisa = parseToPaisa(totalStr);
    const n = participants.length;
    if (n === 0 || totalPaisa <= 0) return participants;

    const base = Math.floor(totalPaisa / n);
    const rem = totalPaisa % n;

    return participants.map((p, idx) => {
      const sharePaisa = base + (idx < rem ? 1 : 0);
      return {
        ...p,
        amountStr: (sharePaisa / 100).toFixed(2).replace(/\.00$/, ''),
      };
    });
  };

  const triggerLookup = useCallback((rowId: string, phoneVal: string) => {
    const cleaned = phoneVal.replace(/\s+/g, '');
    if (cleaned.length < 8) return;

    if (user && cleaned === user.phone.replace(/\s+/g, '')) {
      setRows((prev) =>
        prev.map((r) =>
          r.id === rowId
            ? { ...r, resolvedName: undefined, lookupLoading: false, lookupError: 'Cannot split with yourself' }
            : r
        )
      );
      return;
    }

    setRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, lookupLoading: true, lookupError: undefined } : r))
    );

    api
      .lookupUser(cleaned)
      .then((res: any) => {
        setRows((prev) =>
          prev.map((r) =>
            r.id === rowId
              ? {
                  ...r,
                  resolvedName: res.name,
                  reputation: res.reputation,
                  lookupLoading: false,
                  lookupError: undefined,
                }
              : r
          )
        );
      })
      .catch(() => {
        setRows((prev) =>
          prev.map((r) =>
            r.id === rowId
              ? { ...r, resolvedName: undefined, lookupLoading: false, lookupError: 'User not found' }
              : r
          )
        );
      });
  }, [user]);

  const handlePhoneChange = (id: string, value: string) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, phone: value, resolvedName: undefined, lookupError: undefined } : r))
    );

    if (lookupTimers.current[id]) {
      clearTimeout(lookupTimers.current[id]);
    }

    lookupTimers.current[id] = setTimeout(() => {
      triggerLookup(id, value);
    }, 400);
  };

  const handleAmountChange = (id: string, value: string) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, amountStr: value } : r))
    );
  };

  const handleTotalAmountChange = (val: string) => {
    setTotalAmountInput(val);
    if (splitMode === 'EQUAL') {
      setRows((prev) => recalculateEqualShares(prev, val));
    }
  };

  const handleAddRow = () => {
    const newId = Date.now().toString();
    const newRow: ParticipantRow = { id: newId, phone: '', amountStr: '' };
    const updated = [...rows, newRow];
    if (splitMode === 'EQUAL') {
      setRows(recalculateEqualShares(updated, totalAmountInput));
    } else {
      setRows(updated);
    }
  };

  const handleQuickAddContact = (persona: typeof PERSONAS[0]) => {
    // Check if already in rows
    const existing = rows.find((r) => r.phone.replace(/\s+/g, '') === persona.phone.replace(/\s+/g, ''));
    if (existing) return;

    // Check if there is an empty row we can fill
    const emptyRow = rows.find((r) => !r.phone.trim());
    let updated: ParticipantRow[];

    if (emptyRow) {
      updated = rows.map((r) =>
        r.id === emptyRow.id
          ? { ...r, phone: persona.phone, resolvedName: persona.name, lookupError: undefined }
          : r
      );
    } else {
      const newId = Date.now().toString();
      updated = [
        ...rows,
        { id: newId, phone: persona.phone, amountStr: '', resolvedName: persona.name },
      ];
    }

    if (splitMode === 'EQUAL') {
      setRows(recalculateEqualShares(updated, totalAmountInput));
    } else {
      setRows(updated);
    }
  };

  const handleRemoveRow = (id: string) => {
    if (rows.length <= 2) {
      alert('A shared bill requires at least 2 shares.');
      return;
    }
    const updated = rows.filter((r) => r.id !== id);
    if (splitMode === 'EQUAL') {
      setRows(recalculateEqualShares(updated, totalAmountInput));
    } else {
      setRows(updated);
    }
  };

  const handleToggleSplitMode = (mode: 'EQUAL' | 'CUSTOM') => {
    setSplitMode(mode);
    if (mode === 'EQUAL') {
      const sumPaisa = rows.reduce((acc, row) => acc + parseToPaisa(row.amountStr), 0);
      const totalStr = sumPaisa > 0 ? (sumPaisa / 100).toFixed(2).replace(/\.00$/, '') : totalAmountInput;
      setTotalAmountInput(totalStr);
      setRows((prev) => recalculateEqualShares(prev, totalStr));
    }
  };

  // Compute total strictly from rows
  const totalPaisa = rows.reduce((acc, row) => acc + parseToPaisa(row.amountStr), 0);

  // Available contacts to quick select
  const availableContacts = PERSONAS.filter(
    (p) => p.phone.replace(/\s+/g, '') !== user?.phone.replace(/\s+/g, '')
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setErrorMessage(null);

    if (!title.trim()) {
      setErrorMessage('Please enter a bill title.');
      return;
    }

    if (rows.length < 2) {
      setErrorMessage('A shared bill requires at least 2 participants.');
      return;
    }

    for (const r of rows) {
      if (!r.phone.trim()) {
        setErrorMessage('All participants must have a valid phone number.');
        return;
      }
      if (r.phone.replace(/\s+/g, '') === user.phone.replace(/\s+/g, '')) {
        setErrorMessage('You cannot add yourself as an owing share. You are the creator collecting the shares.');
        return;
      }
      if (parseToPaisa(r.amountStr) <= 0) {
        setErrorMessage('Each share amount must be greater than ৳0.00.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const sharesPayload = rows.map((r) => ({
        phone: r.phone.replace(/\s+/g, ''),
        amount_paisa: parseToPaisa(r.amountStr),
      }));

      const newBill = await api.createBill(user.id, title, sharesPayload);
      router.push(`/bills/${newBill.id}`);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to create shared bill');
    } finally {
      setSubmitting(false);
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
        <h1 className="text-xl font-bold text-on-surface">Create Shared Bill</h1>
      </div>

      <Card className="p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          <Input
            label="Bill Title"
            type="text"
            placeholder="e.g. Dinner at Kacchi Bhai, Fiber Internet"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />

          {/* Quick Select Destination Accounts / Contacts */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-primary" />
              <span>Select Destination Accounts / Quick Contacts:</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {availableContacts.map((contact) => {
                const isSelected = rows.some(
                  (r) => r.phone.replace(/\s+/g, '') === contact.phone.replace(/\s+/g, '')
                );
                return (
                  <button
                    key={contact.id}
                    type="button"
                    onClick={() => handleQuickAddContact(contact)}
                    disabled={isSelected}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition-all flex items-center gap-1.5 border ${
                      isSelected
                        ? 'bg-primary-container text-white border-primary cursor-default opacity-80'
                        : 'bg-surface-container hover:bg-surface-container-high border-outline-variant text-on-surface hover:border-primary'
                    }`}
                  >
                    <span className="font-bold">{isSelected ? '✓' : '+'}</span>
                    <span>{contact.name}</span>
                    <span className="text-[10px] text-on-surface-variant font-mono">({contact.phone.slice(-4)})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Split Mode Selector */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              Split Mode
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleToggleSplitMode('CUSTOM')}
                className={`p-3 rounded-lg border text-left transition-all ${
                  splitMode === 'CUSTOM'
                    ? 'border-primary bg-primary-50/20 shadow-xs'
                    : 'border-outline-variant bg-surface-container-low hover:bg-surface-container'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-on-surface">Custom Shares</span>
                  <Sliders className="w-4 h-4 text-primary" />
                </div>
                <p className="text-[11px] text-on-surface-variant leading-tight">
                  Enter custom payment amounts for each participant
                </p>
              </button>

              <button
                type="button"
                onClick={() => handleToggleSplitMode('EQUAL')}
                className={`p-3 rounded-lg border text-left transition-all ${
                  splitMode === 'EQUAL'
                    ? 'border-primary bg-primary-50/20 shadow-xs'
                    : 'border-outline-variant bg-surface-container-low hover:bg-surface-container'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-on-surface">Equal Split</span>
                  <Percent className="w-4 h-4 text-primary" />
                </div>
                <p className="text-[11px] text-on-surface-variant leading-tight">
                  Specify total bill amount; divided evenly among participants
                </p>
              </button>
            </div>
          </div>

          {/* If Equal Mode, Show Total Input */}
          {splitMode === 'EQUAL' && (
            <div className="p-4 rounded-lg bg-surface-container-low border border-primary/30 space-y-2">
              <label className="text-xs font-semibold text-on-surface block">
                Total Bill Amount to Split Evenly
              </label>
              <Input
                type="text"
                placeholder="৳ 0.00"
                value={totalAmountInput}
                onChange={(e) => handleTotalAmountChange(e.target.value)}
                prefixElement={<span className="font-bold text-primary text-sm">৳</span>}
                className="text-lg font-bold font-mono"
                autoFocus
              />
              <p className="text-[11px] text-on-surface-variant">
                Auto-divided equally among the {rows.length} participants below.
              </p>
            </div>
          )}

          {/* Participant Rows */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                Participant Accounts ({rows.length} People)
              </label>
              <span className="text-[11px] text-outline font-mono">Min 2 participants</span>
            </div>

            <div className="space-y-3">
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="p-3.5 rounded bg-surface-container-low border border-outline-variant space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <Input
                        type="tel"
                        placeholder="Phone: +88017XXXXXXXX"
                        value={row.phone}
                        onChange={(e) => handlePhoneChange(row.id, e.target.value)}
                        suffixElement={
                          row.lookupLoading ? (
                            <span className="text-[10px] text-outline animate-pulse">Checking...</span>
                          ) : row.resolvedName ? (
                            <span className="text-xs font-semibold flex items-center gap-1.5">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              <span className="font-bold text-on-surface">{row.resolvedName}</span>
                              {row.reputation && (
                                <span
                                  className={`inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-bold border ${
                                    row.reputation.tier === 'GOOD'
                                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                      : row.reputation.tier === 'FAIR'
                                      ? 'bg-blue-50 text-blue-800 border-blue-300'
                                      : 'bg-amber-50 text-amber-900 border-amber-300'
                                  }`}
                                >
                                  <span
                                    className={`w-1 h-1 rounded-full ${
                                      row.reputation.tier === 'GOOD'
                                        ? 'bg-emerald-500'
                                        : row.reputation.tier === 'FAIR'
                                        ? 'bg-blue-500'
                                        : 'bg-amber-500'
                                    }`}
                                  />
                                  <span>{row.reputation.tier === 'GOOD' ? 'Good' : row.reputation.tier === 'FAIR' ? 'Fair' : 'Low'}</span>
                                </span>
                              )}
                            </span>
                          ) : row.lookupError ? (
                            <span className="text-[10px] text-error flex items-center gap-1">
                              <UserX className="w-3.5 h-3.5" />
                              <span>{row.lookupError}</span>
                            </span>
                          ) : null
                        }
                      />
                    </div>

                    <div className="w-36">
                      <Input
                        type="text"
                        placeholder="৳ 0.00"
                        value={row.amountStr}
                        onChange={(e) => handleAmountChange(row.id, e.target.value)}
                        readOnly={splitMode === 'EQUAL'}
                        prefixElement={<span className="font-bold text-primary text-xs">৳</span>}
                        className={splitMode === 'EQUAL' ? 'bg-surface-container' : ''}
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRemoveRow(row.id)}
                      className="p-2.5 rounded text-outline hover:text-error hover:bg-rose-50 transition-colors"
                      title="Remove participant"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddRow}
              leftIcon={<Plus className="w-4 h-4" />}
              className="w-full text-xs font-bold py-2"
            >
              Add Participant Account
            </Button>
          </div>

          {/* Computed Live Total */}
          <div className="p-4 rounded-lg bg-surface-container-lowest border border-outline-variant flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant block">
                Total Bill Amount (Auto-computed)
              </span>
              <span className="text-[11px] text-outline">Sum of all participant shares</span>
            </div>
            <span className="font-mono-data text-2xl font-bold text-primary">
              {formatPaisa(totalPaisa)}
            </span>
          </div>

          {errorMessage && (
            <div className="p-3 rounded bg-rose-50 border border-rose-200 text-rose-900 text-xs font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            isLoading={submitting}
            disabled={totalPaisa <= 0}
            className="w-full font-bold py-3"
          >
            Create Shared Bill
          </Button>
        </form>
      </Card>
    </div>
  );
}
