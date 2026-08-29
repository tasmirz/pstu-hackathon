'use client';

import React, { useState } from 'react';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
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
  FileText,
  Database,
  Lock,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Info,
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
  { id: 'dispute', label: 'Disputes & Escrow', tag: 'dispute', icon: ShieldAlert, desc: 'Escrow on open, DM-02 recovery deficit, spend-race (14 scenarios)' },
  { id: 'bills', label: 'Bill Split & Partials', tag: 'bills', icon: Users, desc: 'Integer remainder equal split, safe partial payments (8 scenarios)' },
  { id: 'group', label: 'Group Payments', tag: 'group', icon: Layers, desc: 'All-or-nothing reservation, per-child outcome, safe refunds (3 scenarios)' },
  { id: 'auth', label: 'Auth & TOTP 2FA', tag: 'auth', icon: KeyRound, desc: 'Refresh token rotation, lockout, TOTP RFC 6238 setup & step-up (5 scenarios)' },
  { id: 'requests', label: 'Money Requests', tag: 'requests', icon: ArrowDownLeft, desc: 'Inbox, outbox, cancel, remind, lazy expiry sweep (7 scenarios)' },
  { id: 'notifications', label: 'Notifications Feed', tag: 'notifications', icon: Bell, desc: 'Direct transactional notifications in same ACID commit (5 scenarios)' },
  { id: 'concurrency', label: 'Concurrency & Rings', tag: 'concurrency', icon: Zap, desc: 'Deadlock-free ascending locks, parallel transfers, race barriers (6 scenarios)' },
  { id: 'hold', label: 'HOLD & 60s Undo', tag: 'hold', icon: Clock, desc: 'Tiered undo window, cancellation refund, sweeper settle (4 scenarios)' },
  { id: 'reversal', label: 'Reversals', tag: 'reversal', icon: RotateCcw, desc: 'Compensating transactions, anti-fabrication funds check (4 scenarios)' },
  { id: 'limits', label: 'Limits & Velocity', tag: 'limits', icon: Sliders, desc: 'Daily Dhaka-midnight limit, first-time & threshold step-up (3 scenarios)' },
  { id: 'chaos', label: 'Chaos & Resilience', tag: 'chaos', icon: Flame, desc: 'Crash recovery, duplicate requests, kill simulations (4 scenarios)' },
  { id: 'idempotency', label: 'Idempotency Cache', tag: 'idempotency', icon: Database, desc: 'Key caching, CAS lock protection, replay safety (6 scenarios)' },
  { id: 'validation', label: 'Domain Validation', tag: 'validation', icon: ShieldCheck, desc: 'Self-transfers, negative amounts, frozen accounts (10 scenarios)' },
  { id: 'ledger', label: 'Schema Invariants', tag: 'ledger', icon: Scale, desc: 'Direct SQL assertions on DB constraints and triggers (9 scenarios)' },
];

const TECHNICAL_FEATURES = [
  {
    title: 'Disputes & Escrow Recovery Subsystem',
    suiteTag: 'dispute',
    icon: ShieldAlert,
    tag: 'Round 7',
    summary: 'Guarantees that disputed funds cannot be double-spent while preserving global double-entry conservation.',
    details: [
      'Automatic Escrow Hold: Raising a dispute acquires a row-level lock on the receiver and transfers min(available, disputed_amount) into an ESCROW account.',
      'DM-02 Deficit Handling: If the recipient already spent part of the money before the dispute was filed, available funds are refunded and a deficit recovery case is created without breaking balance invariants.',
      'DM-03 Spend-Dispute Race Barrier: Employs strict ascending lock ordering on ledger.accounts so concurrent spend attempts and dispute requests cannot deadlock or overdraft.',
      'Concurrent Admin Adjudication: Row-level concurrency guards ensure that when two admins simultaneously resolve a dispute, exactly one wins and the second receives a 409 conflict.',
      'Reputation Scoring: Automatically reduces user reputation score in ledger.v_user_reputation when dispute resolutions are confirmed.',
    ],
  },
  {
    title: 'Multi-Party Bill Splitting & Partial Payments',
    suiteTag: 'bills',
    icon: Users,
    tag: 'Round 8',
    summary: 'Zero-loss integer remainder distribution and safe partial share payments with auto-settlement.',
    details: [
      'Integer Remainder Equal Split: Divides N paisa among K participants by computing floor(N/K) and distributing the remainder N mod K paisa to the first shares, guaranteeing total equality without fractional loss.',
      'Safe Partial Payments: Payers can settle shares across multiple partial installments (PARTIALLY_PAID -> PAID), updating remaining balances atomically.',
      'Concurrent Pay-Off Race: Atomically prevents overpayment when two clients simultaneously attempt to pay off the remaining balance of a share.',
      'Automatic Settlement Cascade: As soon as the last pending share is settled, the parent bill automatically transitions to SETTLED.',
      'Creator Immunity: Enforces that bill creators cannot be added as owing shares (422 SELF_TRANSFER).',
    ],
  },
  {
    title: 'Group Payments & Batch Disbursements',
    suiteTag: 'group',
    icon: Layers,
    tag: 'Round 9',
    summary: 'Single-source batch disbursements with atomic balance reservation and per-child execution isolation.',
    details: [
      'All-or-Nothing Balance Reservation: Atomically verifies and holds the entire batch total before executing any child disbursements.',
      'Isolated Per-Child Outcomes: Valid recipients are credited individually; if any recipient is invalid or non-existent, their portion is refunded to the sender (PARTIALLY_COMPLETED).',
      'Insufficient Funds Guard: Rejects underfunded batches immediately with 402 INSUFFICIENT_FUNDS, preventing partial executions.',
    ],
  },
  {
    title: 'Concurrency Engine & Deadlock-Free Ascending Locks',
    suiteTag: 'concurrency',
    icon: Zap,
    tag: 'Core ACID',
    summary: 'Mathematical deadlock elimination via deterministic PostgreSQL row lock ordering.',
    details: [
      'Ascending Lock Ordering: Before modifying account balances, queries lock ledger.accounts rows in strict order: account_a_id < account_b_id.',
      'Cyclic Ring Resolution: Handles multi-party circular transfer rings (A -> B -> C -> A) under high concurrency without database deadlocks.',
      'High-Load Drain Barrier: Multiple simultaneous debit requests against a single account serialize safely and stop cleanly at zero balance without overdraft.',
    ],
  },
  {
    title: 'HOLD Subsystem & 60-Second Delayed Settlement',
    suiteTag: 'hold',
    icon: Clock,
    tag: 'Round 2',
    summary: 'Tiered undo grace period for high-value transactions with automatic background settlement.',
    details: [
      'Tiered Hold Threshold: Transfers of ৳5,000 or greater are marked HELD; funds are moved from the sender active USER account into their dedicated HOLD account.',
      '60-Second Undo Window: Senders can invoke POST /transfers/:id/cancel within 60s to abort the transfer and instantly reclaim funds.',
      'Automated Sweeper Worker: Background sweeper continuously processes expired holds and executes double-entry HOLD_SETTLE transfers to credit recipients.',
      'Idempotency & Race Protection: Late cancel attempts on settled transactions return 409 INVALID_STATE.',
    ],
  },
  {
    title: 'Authentication, Token Rotation & RFC 6238 TOTP 2FA',
    suiteTag: 'auth',
    icon: KeyRound,
    tag: 'Security',
    summary: 'Cryptographic token rotation, brute-force lockouts, and RFC 6238 TOTP two-factor security.',
    details: [
      'Refresh Token Rotation: Every refresh token exchange issues a new refresh token and invalidates the previous one.',
      'Token Family Revocation: If an already-consumed refresh token is replayed, the entire token family is immediately revoked.',
      'Brute-Force Lockout: 5 consecutive invalid PIN submissions lock the account (423 ACCOUNT_LOCKED).',
      'RFC 6238 TOTP Setup & Step-Up: Generates authenticator secrets and verifies 30-second HMAC-SHA1 codes.',
      'Asymmetric Step-Up JWTs: Generates ECDSA/RSA signed JWT step-up tokens with short TTLs for privileged operations.',
    ],
  },
  {
    title: 'Daily Velocity Limits & Dhaka Midnight Reset',
    suiteTag: 'limits',
    icon: Sliders,
    tag: 'Compliance',
    summary: 'Rolling 24-hour spending velocity controls aligned to Asia/Dhaka midnight.',
    details: [
      'Dhaka Midnight Rolling Window: Sums all transfers made by a user since Asia/Dhaka 00:00:00.',
      'Cap Enforcement: Automatically blocks transfers exceeding the daily cap with 403 DAILY_LIMIT_EXCEEDED.',
      'Limit Overrides: Dynamically incorporates per-user limit overrides from ledger.limit_overrides.',
    ],
  },
  {
    title: 'Direct ACID Transactional Notifications',
    suiteTag: 'notifications',
    icon: Bell,
    tag: 'Messaging',
    summary: 'Guaranteed delivery of user notifications committed in the exact same database transaction as money movement.',
    details: [
      'Atomic Notification Inserts: Inserts notification rows (TXN_SENT, TXN_RECEIVED, REQUEST_PAID, REVERSAL) inside the same database transaction.',
      'Zero Discrepancy Guarantee: If a money transfer fails or rolls back, no spurious notifications are ever generated.',
      'Read Receipt Tracking: Manages unread badge counts and query filters (?unread=true).',
    ],
  },
];

export default function SimulatorDashboardPage() {
  const [runningSuite, setRunningSuite] = useState<string | null>(null);
  const [resetBeforeRun, setResetBeforeRun] = useState(false);
  const [activeGroupResults, setActiveGroupResults] = useState<GroupResult[] | null>(null);
  const [rawOutput, setRawOutput] = useState<string>('');
  const [overallStatus, setOverallStatus] = useState<'IDLE' | 'RUNNING' | 'PASS' | 'FAIL'>('IDLE');
  const [stats, setStats] = useState<{ passed: number; failed: number; total: number } | null>(null);
  const [expandedFeature, setExpandedFeature] = useState<number | null>(0);

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
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-purple-100 text-purple-800 border border-purple-300">
              88 Scenarios
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
            <p className="text-lg font-bold text-on-surface">15 Test Suites</p>
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

      {/* Technical Features & Judge Architecture Reference */}
      <div className="space-y-4 pt-4 border-t border-outline-variant">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-on-surface flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              <span>Judge Technical Architecture & Feature Reference</span>
            </h2>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Comprehensive breakdown of ACID guarantees, database locking mechanics, and domain edge cases.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {TECHNICAL_FEATURES.map((feat, idx) => {
            const Icon = feat.icon;
            const isExpanded = expandedFeature === idx;
            return (
              <Card key={idx} className="p-4 bg-surface-container-lowest border border-outline-variant space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-sm text-on-surface">{feat.title}</h3>
                        <Badge variant="neutral" className="text-[10px] py-0 px-1.5 font-mono">
                          {feat.tag}
                        </Badge>
                      </div>
                      <p className="text-xs text-on-surface-variant mt-0.5 leading-relaxed">
                        {feat.summary}
                      </p>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => runSuite(feat.suiteTag, feat.suiteTag)}
                    disabled={runningSuite !== null}
                    className="text-[11px] py-1 px-2.5 shrink-0"
                  >
                    Run Test
                  </Button>
                </div>

                <div className="pt-2 border-t border-outline-variant">
                  <button
                    type="button"
                    onClick={() => setExpandedFeature(isExpanded ? null : idx)}
                    className="flex items-center justify-between w-full text-xs font-semibold text-primary hover:underline"
                  >
                    <span>{isExpanded ? 'Hide Technical Details' : 'View Invariant & Locking Details'}</span>
                    {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </button>

                  {isExpanded && (
                    <ul className="mt-2.5 space-y-1.5 text-xs text-on-surface-variant list-disc list-inside bg-surface-container-low p-3 rounded border border-outline-variant">
                      {feat.details.map((detail, dIdx) => (
                        <li key={dIdx} className="leading-relaxed">
                          <span className="text-on-surface font-medium">{detail.split(':')[0]}:</span>
                          <span>{detail.substring(detail.indexOf(':') + 1)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Results & Live Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-1 gap-6 pt-4 border-t border-outline-variant">
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
