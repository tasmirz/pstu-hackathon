'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { useAuth } from '@/lib/auth-context';
import { formatPaisa, formatDate } from '@/lib/money';
import { api } from '@/lib/api';
import { Dispute } from '@/lib/types';
import { ShieldAlert, ArrowUpRight, Clock, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';

export default function MyDisputesPage() {
  const { user } = useAuth();
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchDisputes = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const list = await api.getDisputes(user.id);
      setDisputes(list);
    } catch (err) {
      console.error('Failed to load my disputes', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDisputes();
  }, [user]);

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-outline-variant">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary-fixed text-primary flex items-center justify-center">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-on-surface">My Disputes</h1>
            <p className="text-xs text-on-surface-variant">
              Track and monitor the status of transactions you have contested
            </p>
          </div>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={fetchDisputes}
          leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
        >
          Refresh
        </Button>
      </div>

      {/* Disputes List */}
      <Card className="p-0 overflow-hidden divide-y divide-outline-variant">
        {disputes.length === 0 ? (
          <div className="p-12 text-center text-xs text-on-surface-variant">
            You have not raised any disputes. If you notice an incorrect transfer, you can dispute it from Transaction Detail.
          </div>
        ) : (
          disputes.map((d) => (
            <div key={d.id} className="p-5 space-y-3 hover:bg-surface-container-low transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        d.state === 'REVERSED'
                          ? 'success'
                          : d.state === 'REJECTED'
                          ? 'error'
                          : 'warning'
                      }
                    >
                      {d.state === 'OPEN' ? '● OPEN' : d.state === 'REVERSED' ? '✓ REVERSED' : '✗ REJECTED'}
                    </Badge>
                    <span className="font-mono text-xs font-bold text-outline">#{d.id}</span>
                  </div>

                  <p className="text-sm font-bold text-on-surface">
                    {formatPaisa(d.transaction?.amount_paisa)} to {d.counterparty?.name}
                  </p>
                  <p className="text-xs italic text-on-surface-variant">"{d.reason}"</p>
                </div>

                <Link href={`/transactions/${d.txn_id}`}>
                  <Button variant="outline" size="sm" rightIcon={<ArrowUpRight className="w-3 h-3" />} className="text-xs">
                    View txn
                  </Button>
                </Link>
              </div>

              {/* Status Explanation / Admin Resolution */}
              {d.state === 'OPEN' ? (
                <div className="p-2.5 rounded bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>An admin will review this dispute. This does not move any money until approved.</span>
                </div>
              ) : (
                <div className="p-2.5 rounded bg-surface-container-low border border-outline-variant text-xs space-y-1">
                  <span className="font-bold text-on-surface block">
                    Admin Resolution ({d.state === 'REVERSED' ? 'Approved & Reversed' : 'Rejected'}):
                  </span>
                  <p className="italic text-on-surface-variant">"{d.resolution || 'Resolution concluded.'}"</p>
                  {d.resolved_at && (
                    <span className="text-[10px] text-outline block">
                      Resolved {formatDate(d.resolved_at)}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
