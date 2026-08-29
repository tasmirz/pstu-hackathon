'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { useAuth } from '@/lib/auth-context';
import { formatPaisa, parseToPaisa } from '@/lib/money';
import { api } from '@/lib/api';
import { ArrowLeft, Plus, Trash2, CheckCircle2, UserX, AlertTriangle, Sparkles } from 'lucide-react';

interface ParticipantRow {
  id: string;
  phone: string;
  amountStr: string;
  resolvedName?: string;
  lookupLoading?: boolean;
  lookupError?: string;
}

export default function CreateBillPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [title, setTitle] = useState('Dinner at Kacchi Bhai');
  const [rows, setRows] = useState<ParticipantRow[]>([
    { id: '1', phone: '+8801798765432', amountStr: '400', resolvedName: 'Karim U.' },
    { id: '2', phone: '+8801755667788', amountStr: '400', resolvedName: 'Nadia S.' },
  ]);

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Compute total strictly from rows
  const totalPaisa = rows.reduce((acc, row) => acc + parseToPaisa(row.amountStr), 0);

  const handleAddRow = () => {
    setRows((prev) => [
      ...prev,
      { id: Date.now().toString(), phone: '', amountStr: '' },
    ]);
  };

  const handleRemoveRow = (id: string) => {
    if (rows.length <= 2) {
      alert('A shared bill requires at least 2 shares.');
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const handlePhoneChange = (id: string, value: string) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, phone: value, resolvedName: undefined, lookupError: undefined } : r))
    );
  };

  const handleAmountChange = (id: string, value: string) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, amountStr: value } : r))
    );
  };

  // Debounced lookup for rows
  useEffect(() => {
    rows.forEach((row) => {
      if (row.phone && row.phone.length >= 8 && !row.resolvedName && !row.lookupError && !row.lookupLoading) {
        // Trigger lookup
        setRows((prev) =>
          prev.map((r) => (r.id === row.id ? { ...r, lookupLoading: true } : r))
        );

        api
          .lookupUser(row.phone)
          .then((res) => {
            setRows((prev) =>
              prev.map((r) =>
                r.id === row.id
                  ? { ...r, resolvedName: res.name, lookupLoading: false, lookupError: undefined }
                  : r
              )
            );
          })
          .catch(() => {
            setRows((prev) =>
              prev.map((r) =>
                r.id === row.id
                  ? { ...r, resolvedName: undefined, lookupLoading: false, lookupError: 'User not found' }
                  : r
              )
            );
          });
      }
    });
  }, [rows]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setErrorMessage(null);

    // Client-side validations
    if (!title.trim()) {
      setErrorMessage('Please enter a bill title.');
      return;
    }

    if (rows.length < 2) {
      setErrorMessage('A shared bill requires at least 2 people.');
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

          {/* Participant Rows */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                Split with ({rows.length} People)
              </label>
              <span className="text-[11px] text-outline font-mono">Min 2 participants</span>
            </div>

            <div className="space-y-3">
              {rows.map((row, idx) => (
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
                            <span className="text-xs font-bold text-emerald-800 flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              <span>{row.resolvedName}</span>
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
                        prefixElement={<span className="font-bold text-primary text-xs">৳</span>}
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
              Add Another Person
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
