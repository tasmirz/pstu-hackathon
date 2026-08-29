'use client';

import React, { useState } from 'react';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import {
  Play,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  Scale,
  Zap,
  Users,
  KeyRound,
  ShieldAlert,
  ArrowDownLeft,
  Bell,
  Sliders,
  Terminal,
  Activity,
  Layers,
  Flame,
} from 'lucide-react';

interface ScenarioResult {
  id: string;
  name: string;
  pass: boolean;
  duration_ms?: number;
  error?: string;
  before?: {
    conservationTotalPaisa: number;
    driftRows: any[];
    negativeRows: any[];
    unbalancedTxns: any[];
  };
  after?: {
    conservationTotalPaisa: number;
    driftRows: any[];
    negativeRows: any[];
    unbalancedTxns: any[];
  };
}

interface GroupResult {
  group: string;
  outcomes: ScenarioResult[];
}

const SUITES = [
  { id: 'all', label: 'Run All Suites', tag: '', icon: Play, desc: 'Complete end-to-end invariant verification (88 scenarios)', color: 'bg-emerald-600 hover:bg-emerald-700 text-white' },
  { id: 'disputes', label: 'Disputes & Escrow', tag: 'disputes', icon: ShieldAlert, desc: 'Escrow on open, DM-02 recovery deficit, spend-race (14 scenarios)', color: 'bg-blue-600 hover:bg-blue-700 text-white' },
  { id: 'bills', label: 'Bill Split & Partial', tag: 'bills', icon: Users, desc: 'Equal split integer remainder, safe partial payments (8 scenarios)', color: 'bg-indigo-600 hover:bg-indigo-700 text-white' },
  { id: 'group', label: 'Group Payments', tag: 'group', icon: Layers, desc: 'All-or-nothing reservation, per-child outcome, safe refunds (3 scenarios)', color: 'bg-purple-600 hover:bg-purple-700 text-white' },
  { id: 'auth', label: 'Auth & TOTP 2FA', tag: 'auth', icon: KeyRound, desc: 'Refresh token rotation, lockout, TOTP RFC 6238 setup & step-up (5 scenarios)', color: 'bg-amber-600 hover:bg-amber-700 text-white' },
  { id: 'requests', label: 'Money Requests', tag: 'requests', icon: ArrowDownLeft, desc: 'Inbox, outbox, cancel, remind, lazy expiry sweep (7 scenarios)', color: 'bg-teal-600 hover:bg-teal-700 text-white' },
  { id: 'notifications', label: 'Notifications Feed', tag: 'notifications', icon: Bell, desc: 'Direct transactional notifications in same ACID commit (5 scenarios)', color: 'bg-cyan-600 hover:bg-cyan-700 text-white' },
  { id: 'concurrency', label: 'Concurrency & Rings', tag: 'concurrency', icon: Zap, desc: 'Deadlock-free ascending locks, parallel transfers, race barriers (6 scenarios)', color: 'bg-orange-600 hover:bg-orange-700 text-white' },
  { id: 'hold', label: 'HOLD & 60s Undo', tag: 'hold', icon: Clock, desc: 'Tiered undo window, cancellation refund, sweeper settle (4 scenarios)', color: 'bg-yellow-600 hover:bg-yellow-700 text-white' },
  { id: 'reversal', label: 'Reversals', tag: 'reversal', icon: RotateCcw, desc: 'Compensating transactions, anti-fabrication funds check (4 scenarios)', color: 'bg-rose-600 hover:bg-rose-700 text-white' },
  { id: 'limits', label: 'Limits & Step-Up', tag: 'limits', icon: Sliders, desc: 'Daily Dhaka-midnight limit, first-time & threshold step-up (3 scenarios)', color: 'bg-slate-700 hover:bg-slate-800 text-white' },
  { id: 'chaos', label: 'Chaos & Resilience', tag: 'chaos', icon: Flame, desc: 'Crash recovery, duplicate requests, kill simulations (4 scenarios)', color: 'bg-red-700 hover:bg-red-800 text-white' },
];

export default function SimulatorDashboardPage() {
  const [runningSuite, setRunningSuite] = useState<string | null>(null);
  const [resetBeforeRun, setResetBeforeRun] = useState(false);
  const [activeGroupResults, setActiveGroupResults] = useState<GroupResult[] | null>(null);
  const [rawOutput, setRawOutput] = useState<string>('');
  const [overallStatus, setOverallStatus] = useState<'IDLE' | 'RUNNING' | 'PASS' | 'FAIL'>('IDLE');
  const [stats, setStats] = useState<{ passed: number; failed: number; total: number } | null>(null);

  const runSuite = async (suiteId: string, tag: string) => {
    setRunningSuite(suiteId);
    setOverallStatus('RUNNING');
    setRawOutput('Running scenario suite against real PostgreSQL / NestJS backend on http://localhost:3000...\n');

    try {
      const res = await fetch('/api/sim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tag: tag || undefined,
          reset: resetBeforeRun,
        }),
      });

      const data = await res.json();
      setRawOutput(data.output || data.error || 'No output received.');

      if (data.results && Array.isArray(data.results)) {
        setActiveGroupResults(data.results);
        let p = 0;
        let f = 0;
        for (const g of data.results) {
          for (const o of g.outcomes) {
            if (o.pass) p++;
            else f++;
          }
        }
        setStats({ passed: p, failed: f, total: p + f });
        setOverallStatus(f === 0 ? 'PASS' : 'FAIL');
      } else {
        // Parse stdout if JSON wasn't returned
        const passMatch = data.output?.match(/(\d+) passed/);
        const failMatch = data.output?.match(/(\d+) failed/);
        const p = passMatch ? parseInt(passMatch[1], 10) : (data.success ? 1 : 0);
        const f = failMatch ? parseInt(failMatch[1], 10) : (data.success ? 0 : 1);
        setStats({ passed: p, failed: f, total: p + f });
        setOverallStatus(f === 0 && data.success ? 'PASS' : 'FAIL');
      }
    } catch (err: any) {
      setRawOutput(`Error running simulator: ${err.message}`);
      setOverallStatus('FAIL');
    } finally {
      setRunningSuite(null);
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-outline-variant">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300">
              Live HTTP & ACID Harness
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-800 border border-blue-300">
              NestJS :3000
            </span>
          </div>
          <h1 className="text-2xl font-bold text-on-surface mt-1">Simulator Interactive Dashboard</h1>
          <p className="text-xs text-on-surface-variant">
            Trigger automated HTTP scenario suites, verify double-entry conservation, and inspect live invariant proofs.
          </p>
        </div>

        {/* Global Controls */}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-semibold text-on-surface-variant cursor-pointer bg-surface-container px-3 py-2 rounded border border-outline-variant">
            <input
              type="checkbox"
              checked={resetBeforeRun}
              onChange={(e) => setResetBeforeRun(e.target.checked)}
              className="rounded text-primary focus:ring-0"
            />
            <span>Clean Slate (--reset)</span>
          </label>
        </div>
      </div>

      {/* Metrics Banner */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4 flex items-center gap-3 border-l-4 border-emerald-500 bg-surface-container-lowest">
          <Scale className="w-8 h-8 text-emerald-600 shrink-0" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-outline">Conservation Invariant</p>
            <p className="text-lg font-bold text-emerald-700">∑(entries) === 0</p>
            <p className="text-[10px] text-on-surface-variant">Zero balance drift</p>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3 border-l-4 border-blue-500 bg-surface-container-lowest">
          <Activity className="w-8 h-8 text-blue-600 shrink-0" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-outline">Execution Status</p>
            <p className="text-lg font-bold text-on-surface">
              {overallStatus === 'IDLE' && 'Ready to Test'}
              {overallStatus === 'RUNNING' && 'Testing in Progress...'}
              {overallStatus === 'PASS' && '100% Passed'}
              {overallStatus === 'FAIL' && 'Failures Detected'}
            </p>
            <p className="text-[10px] text-on-surface-variant">
              {stats ? `${stats.passed}/${stats.total} Scenarios Passed` : 'Select a suite below'}
            </p>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3 border-l-4 border-purple-500 bg-surface-container-lowest">
          <ShieldCheck className="w-8 h-8 text-purple-600 shrink-0" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-outline">Supported Features</p>
            <p className="text-lg font-bold text-on-surface">12 Test Suites</p>
            <p className="text-[10px] text-on-surface-variant">Rounds 1–9 + TOTP 2FA</p>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3 border-l-4 border-amber-500 bg-surface-container-lowest">
          <Clock className="w-8 h-8 text-amber-600 shrink-0" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-outline">ACID Discipline</p>
            <p className="text-lg font-bold text-on-surface">Ascending Locks</p>
            <p className="text-[10px] text-on-surface-variant">Deadlock-free guarantees</p>
          </div>
        </Card>
      </div>

      {/* Graphic Action Buttons Matrix */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-outline">Graphic Scenario Buttons</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {SUITES.map((suite) => {
            const Icon = suite.icon;
            const isRunning = runningSuite === suite.id;
            return (
              <button
                key={suite.id}
                onClick={() => runSuite(suite.id, suite.tag)}
                disabled={runningSuite !== null}
                className={`p-4 rounded-lg border border-outline-variant text-left transition-all duration-150 flex flex-col justify-between gap-3 shadow-xs hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed ${
                  suite.id === 'all'
                    ? 'bg-gradient-to-br from-emerald-600 to-teal-700 text-white col-span-1 sm:col-span-2 lg:col-span-3'
                    : 'bg-surface-container-lowest hover:bg-surface-container-low'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                        suite.id === 'all' ? 'bg-white/20 text-white' : 'bg-primary/10 text-primary'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className={`font-bold text-sm leading-tight ${suite.id === 'all' ? 'text-white' : 'text-on-surface'}`}>
                        {suite.label}
                      </h3>
                      <p className={`text-[11px] mt-0.5 line-clamp-1 ${suite.id === 'all' ? 'text-emerald-100' : 'text-on-surface-variant'}`}>
                        {suite.desc}
                      </p>
                    </div>
                  </div>

                  <span
                    className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 ${
                      isRunning
                        ? 'bg-amber-400 text-amber-950 animate-pulse'
                        : suite.id === 'all'
                        ? 'bg-white text-emerald-900'
                        : 'bg-surface-container text-on-surface-variant'
                    }`}
                  >
                    {isRunning ? 'Running...' : 'Execute'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Results & Live Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-1 gap-6">
        {/* Terminal Live Output */}
        <Card className="p-4 bg-slate-950 border-slate-800 text-slate-100 font-mono text-xs shadow-md">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-emerald-400" />
              <span className="font-bold text-slate-300">Live Simulator Console Output</span>
            </div>
            {overallStatus === 'PASS' && (
              <span className="flex items-center gap-1 text-emerald-400 font-bold text-[11px]">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>ALL CHECKS PASSED</span>
              </span>
            )}
            {overallStatus === 'FAIL' && (
              <span className="flex items-center gap-1 text-rose-400 font-bold text-[11px]">
                <XCircle className="w-3.5 h-3.5" />
                <span>FAILURES DETECTED</span>
              </span>
            )}
          </div>

          <pre className="overflow-x-auto whitespace-pre-wrap max-h-96 text-slate-300 text-[11px] leading-relaxed font-mono">
            {rawOutput || 'Click any scenario button above to start verification.'}
          </pre>
        </Card>
      </div>
    </div>
  );
}
