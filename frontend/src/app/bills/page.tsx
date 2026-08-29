'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { useAuth } from '@/lib/auth-context';
import { formatPaisa, formatDate } from '@/lib/money';
import { api } from '@/lib/api';
import { Bill } from '@/lib/types';
import { Users, Plus, ArrowUpRight, CheckCircle2, Clock, RefreshCw } from 'lucide-react';

export default function BillsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'created' | 'owed'>('owed');
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchBills = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const list = await api.getBills(user.id, tab);
      setBills(list);
    } catch (err) {
      console.error('Failed to fetch bills', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBills();
  }, [user?.id, tab]);

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-outline-variant">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary-fixed text-primary flex items-center justify-center">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-on-surface">Shared Bills</h1>
            <p className="text-xs text-on-surface-variant">
              Multi-party bill splitting and group expense settlements
            </p>
          </div>
        </div>

        <Link href="/bills/create">
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Plus className="w-4 h-4" />}
            className="font-bold text-xs"
          >
            Create Shared Bill
          </Button>
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex p-1 bg-surface-container-low rounded border border-outline-variant w-full sm:w-80">
        <button
          onClick={() => setTab('owed')}
          className={`flex-1 py-1.5 text-xs font-semibold rounded uppercase tracking-wider transition-colors ${
            tab === 'owed' ? 'bg-primary text-white shadow-xs' : 'text-on-surface-variant'
          }`}
        >
          Owed by Me
        </button>
        <button
          onClick={() => setTab('created')}
          className={`flex-1 py-1.5 text-xs font-semibold rounded uppercase tracking-wider transition-colors ${
            tab === 'created' ? 'bg-primary text-white shadow-xs' : 'text-on-surface-variant'
          }`}
        >
          Created by Me
        </button>
      </div>

      {/* Bills List */}
      <Card className="p-0 overflow-hidden divide-y divide-outline-variant">
        {loading ? (
          <div className="p-12 text-center text-xs text-on-surface-variant">Loading bills...</div>
        ) : bills.length === 0 ? (
          <div className="p-12 text-center text-xs text-on-surface-variant">
            {tab === 'owed' ? 'You do not owe any shared bills.' : 'You have not created any shared bills yet.'}
          </div>
        ) : (
          bills.map((bill) => {
            const shares = bill.shares || [];
            const paidCount = shares.filter((s) => s.state === 'PAID').length;
            const totalCount = shares.length;
            const myShare = user ? (shares.find((s) => s.payer?.id === user.id) || (bill as any).my_share) : null;

            return (
              <Link
                key={bill.id}
                href={`/bills/${bill.id}`}
                className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:bg-surface-container-low transition-colors block"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-on-surface">{bill.title}</span>
                    <Badge variant={bill.state === 'SETTLED' ? 'success' : bill.state === 'CANCELLED' ? 'error' : 'neutral'}>
                      {bill.state}
                    </Badge>
                  </div>

                  <p className="text-xs text-on-surface-variant">
                    Created by {bill.created_by?.id === user?.id ? 'You' : bill.created_by?.name || 'Unknown'} · {formatDate(bill.created_at)}
                  </p>

                  <div className="flex items-center gap-3 text-xs text-outline pt-0.5">
                    {totalCount > 0 && (
                      <span className="font-semibold text-on-surface">
                        {paidCount} of {totalCount} shares paid
                      </span>
                    )}
                    {myShare && (
                      <span className={`font-semibold ${myShare.state === 'PAID' ? 'text-emerald-800' : 'text-amber-900 font-bold'}`}>
                        Your share: {formatPaisa(myShare.amount_paisa)} ({myShare.state})
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex sm:flex-col items-end justify-between sm:justify-start w-full sm:w-auto gap-2">
                  <span className="font-mono-data font-bold text-base text-primary">
                    {formatPaisa(bill.total_amount_paisa)}
                  </span>
                  <span className="text-xs text-primary font-semibold flex items-center gap-1">
                    <span>View status board</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </Link>
            );
          })
        )}
      </Card>
    </div>
  );
}
