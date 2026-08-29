'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { useAuth } from '@/lib/auth-context';
import { formatPaisa, formatDate, timeAgo } from '@/lib/money';
import { api } from '@/lib/api';
import { Transaction } from '@/lib/types';
import {
  ArrowUpRight,
  ArrowDownLeft,
  RotateCcw,
  Filter,
  ChevronRight,
  RefreshCw,
  Search,
  AlertOctagon,
} from 'lucide-react';

export default function HistoryPage() {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [direction, setDirection] = useState<'all' | 'sent' | 'received' | 'reversals'>('all');
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchTransactions = async (cursor?: number, append = false) => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await api.getTransactions(user.id, 10, cursor, direction);
      if (append) {
        setTransactions((prev) => [...prev, ...res.items]);
      } else {
        setTransactions(res.items);
      }
      setNextCursor(res.next_cursor);
      setHasMore(res.has_more);
    } catch (err) {
      console.error('Failed to load transaction history', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions();
  }, [user, direction]);

  const filtered = transactions.filter((t) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      t.counterparty?.name?.toLowerCase().includes(q) ||
      t.note?.toLowerCase().includes(q) ||
      t.ref.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-on-surface">Transaction History</h1>
          <p className="text-xs text-on-surface-variant">
            Immutable Double-Entry Ledger Records (Keyset Paginated)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/disputes" className="flex-1 sm:flex-none">
            <Button
              variant="outline"
              size="sm"
              leftIcon={<AlertOctagon className="w-3.5 h-3.5" />}
              className="w-full sm:w-auto font-bold text-xs"
            >
              Raise Dispute
            </Button>
          </Link>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fetchTransactions()}
            leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <Card className="p-4 flex flex-col md:flex-row gap-4 justify-between items-center bg-surface-container-low">
        {/* Direction Filter Tabs */}
        <div className="flex p-1 bg-surface-container rounded border border-outline-variant w-full md:w-auto">
          {(['all', 'sent', 'received', 'reversals'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setDirection(tab)}
              className={`flex-1 md:flex-none px-3 py-1.5 rounded text-xs font-semibold uppercase tracking-wider transition-colors ${
                direction === tab
                  ? 'bg-primary text-white shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Search Field */}
        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 text-outline absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search by name, note, ref..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs rounded bg-surface-container-lowest border border-outline-variant text-on-surface focus:outline-none focus:border-primary"
          />
        </div>
      </Card>

      {/* Transactions List */}
      <Card className="p-0 overflow-hidden divide-y divide-outline-variant">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-on-surface-variant text-xs">
            {loading ? 'Loading ledger entries...' : 'No transactions found.'}
          </div>
        ) : (
          filtered.map((txn) => {
            const isSent = txn.entries?.[0]?.amount_paisa ? txn.entries[0].amount_paisa < 0 : true;
            const isReversal = txn.kind === 'REVERSAL';

            return (
              <Link
                key={txn.id}
                href={`/transactions/${txn.id}`}
                className="flex items-center justify-between p-4 hover:bg-surface-container-low transition-colors group"
              >
                <div className="flex items-center gap-3.5">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
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
                    <p className="text-sm font-semibold text-on-surface group-hover:text-primary transition-colors">
                      {isReversal
                        ? txn.note || 'Reversed Transaction'
                        : isSent
                        ? `Sent to ${txn.counterparty?.name || 'Recipient'}`
                        : `Received from ${txn.counterparty?.name || 'Sender'}`}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-on-surface-variant">{formatDate(txn.created_at)}</span>
                      <span className="text-[11px] text-outline font-mono">({timeAgo(txn.created_at)})</span>
                      <span className="text-[10px] font-mono uppercase bg-surface-container px-1.5 py-0.5 rounded text-on-surface-variant">
                        {txn.kind}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p
                      className={`font-mono-data text-sm font-bold ${
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
                  <ChevronRight className="w-4 h-4 text-outline group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                </div>
              </Link>
            );
          })
        )}
      </Card>

      {/* Keyset Load More */}
      {hasMore && (
        <div className="text-center pt-2">
          <Button
            variant="secondary"
            onClick={() => nextCursor && fetchTransactions(nextCursor, true)}
            isLoading={loading}
            className="px-8 font-semibold"
          >
            Load More Transactions
          </Button>
        </div>
      )}
    </div>
  );
}
