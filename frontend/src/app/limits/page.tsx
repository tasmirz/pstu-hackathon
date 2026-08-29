'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { formatPaisa, formatDate } from '@/lib/money';
import { api } from '@/lib/api';
import { LimitsResponse } from '@/lib/types';
import { useAuth } from '@/lib/auth-context';
import { Sliders, ShieldCheck, Zap, Clock, Info } from 'lucide-react';

export default function LimitsPage() {
  const { user } = useAuth();
  const [limits, setLimits] = useState<LimitsResponse | null>(null);

  useEffect(() => {
    if (!user) return;
    api.getLimits(user.id).then(setLimits).catch(console.error);
  }, [user]);

  const spentPaisa = limits?.spent_today_paisa || 250000;
  const totalPaisa = limits?.daily_limit_paisa || 5000000;
  const remainingPaisa = limits?.remaining_paisa || 4750000;
  const percentUsed = Math.min(100, Math.round((spentPaisa / totalPaisa) * 100));

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-on-surface">Account Limits & Velocity</h1>
        <p className="text-xs text-on-surface-variant">
          Daily transfer caps and real-time velocity rate-limiting rules
        </p>
      </div>

      {/* Daily Limits Card */}
      <Card className="p-6 space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-outline-variant">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-primary" />
            <h2 className="text-base font-bold text-on-surface">Daily Send Allowance</h2>
          </div>
          <span className="text-xs font-mono font-bold text-primary">
            {formatPaisa(remainingPaisa)} Left Today
          </span>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-on-surface-variant font-medium">
            <span>Spent today: {formatPaisa(spentPaisa)}</span>
            <span>Limit: {formatPaisa(totalPaisa)}</span>
          </div>
          <div className="w-full bg-surface-container h-3 rounded-full overflow-hidden">
            <div
              className="bg-primary h-full rounded-full transition-all duration-500"
              style={{ width: `${percentUsed}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs pt-2">
          <div className="p-3 rounded bg-surface-container-low border border-outline-variant">
            <span className="text-outline uppercase text-[10px] font-bold block mb-1">Limit Resets At</span>
            <span className="font-semibold text-on-surface">Midnight (00:00 BST)</span>
          </div>
          <div className="p-3 rounded bg-surface-container-low border border-outline-variant">
            <span className="text-outline uppercase text-[10px] font-bold block mb-1">Tier Level</span>
            <span className="font-semibold text-emerald-800">Tier 1 Verified</span>
          </div>
        </div>
      </Card>

      {/* Velocity Guard Rules */}
      <Card className="p-6 bg-surface-container-low space-y-4 text-xs">
        <div className="flex items-center gap-2 text-primary font-bold text-sm">
          <Zap className="w-4 h-4" />
          <span>Velocity & High-Frequency Transfer Safeguards</span>
        </div>

        <div className="space-y-2.5 text-on-surface-variant">
          <div className="p-3 rounded bg-surface-container-lowest border border-outline-variant flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-on-surface">10 Transfers / Minute Soft Cap</p>
              <p className="text-[11px] mt-0.5">
                Exceeding 10 transfers within a 60-second window triggers an inline PIN challenge to prevent automated drain attacks.
              </p>
            </div>
          </div>

          <div className="p-3 rounded bg-surface-container-lowest border border-outline-variant flex items-start gap-2.5">
            <Clock className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-on-surface">৳5,000+ Delayed Hold Grace Period</p>
              <p className="text-[11px] mt-0.5">
                Transfers above ৳5,000 automatically grant a 60-second undo window so mistaken transfers can be cancelled before settlement.
              </p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
