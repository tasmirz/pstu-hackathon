'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { useAuth } from '@/lib/auth-context';
import { formatPaisa, parseToPaisa } from '@/lib/money';
import { getIdempotencyKey, clearIdempotencyKey } from '@/lib/idempotency';
import { api } from '@/lib/api';
import {
  Send,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  UserCheck,
  UserX,
  Lock,
  Timer,
  Sparkles,
  Users,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { PERSONAS } from '@/components/common/UserSwitcher';

interface RecipientLookup {
  id: number;
  name: string;
  fullName?: string;
  phone: string;
  is_first_time?: boolean;
}

export default function SendMoneyPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-xs text-on-surface-variant">Loading transfer module...</div>}>
      <SendMoneyContent />
    </Suspense>
  );
}

function SendMoneyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, balance, refreshBalance, requestStepUp } = useAuth();

  // 3 explicit steps: 1 = Form, 2 = Confirm, 3 = Result
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Form State
  const [phone, setPhone] = useState(searchParams.get('to') || '+8801798765432');
  const [amountStr, setAmountStr] = useState(searchParams.get('amount') || '2500');
  const [note, setNote] = useState('lunch');
  const [reqId, setReqId] = useState<string | null>(searchParams.get('reqId'));

  // Lookup State
  const [lookupLoading, setLookupLoading] = useState(false);
  const [recipient, setRecipient] = useState<RecipientLookup | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // Confirmation & Step-Up State
  const [isDuplicateSend, setIsDuplicateSend] = useState(false);
  const [stepUpPin, setStepUpPin] = useState('');
  const [requiresInlineStepUp, setRequiresInlineStepUp] = useState(false);
  const [stepUpError, setStepUpError] = useState<string | null>(null);

  // Submission State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [resultData, setResultData] = useState<{
    transaction: any;
    balance_paisa: number;
    isHeld: boolean;
  } | null>(null);

  // Debounced recipient lookup
  useEffect(() => {
    if (!phone || phone.length < 8) {
      setRecipient(null);
      setLookupError(null);
      return;
    }

    if (user && phone.replace(/\s+/g, '') === user.phone.replace(/\s+/g, '')) {
      setRecipient(null);
      setLookupError('You cannot transfer money to yourself.');
      return;
    }

    setLookupLoading(true);
    setLookupError(null);

    const timer = setTimeout(async () => {
      try {
        const data = await api.lookupUser(phone);
        setRecipient(data);
        setLookupError(null);
      } catch (err: any) {
        setRecipient(null);
        setLookupError('No user found with this phone number.');
      } finally {
        setLookupLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [phone, user]);

  const amountPaisa = parseToPaisa(amountStr);

  const handleProceedToConfirm = () => {
    if (!recipient || amountPaisa <= 0) return;

    if (amountPaisa > balance) {
      setApiError(`Not enough balance. You have ${formatPaisa(balance)}.`);
      return;
    }

    // Check duplicate send guard
    const recentSends = sessionStorage.getItem('kinetic_recent_sends');
    if (recentSends) {
      try {
        const list = JSON.parse(recentSends);
        const duplicate = list.find(
          (s: any) =>
            s.phone === recipient.phone &&
            Math.abs(s.amount_paisa - amountPaisa) < 10000 &&
            Date.now() - s.time < 120000
        );
        if (duplicate) {
          setIsDuplicateSend(true);
        }
      } catch {
        // ignore
      }
    }

    // Check if step-up required by rule (>৳20k or first time)
    if (amountPaisa > 2000000 || recipient.is_first_time) {
      setRequiresInlineStepUp(true);
    } else {
      setRequiresInlineStepUp(false);
    }

    setStep(2);
  };

  const handleConfirmAndSend = async () => {
    if (!recipient || !user) return;

    setIsSubmitting(true);
    setApiError(null);

    // Reuse or create idempotency key for this send attempt
    const formId = `send_${recipient.phone}_${amountPaisa}`;
    const idemKey = getIdempotencyKey(formId);

    // Real step-up token from POST /auth/step-up; mock mode returns a marker.
    const stepUpToken = stepUpPin ? await api.stepUp(stepUpPin) : undefined;

    try {
      let res: any;
      if (reqId) {
        res = await api.payMoneyRequest(user.id, parseInt(reqId, 10), idemKey, stepUpToken);
      } else {
        res = await api.createTransfer(user.id, recipient.phone, amountPaisa, note, idemKey, stepUpToken);
      }

      // Success: clear idempotency key
      clearIdempotencyKey(formId);

      // Record in recent sends for duplicate guard
      const recent = [{ phone: recipient.phone, amount_paisa: amountPaisa, time: Date.now() }];
      sessionStorage.setItem('kinetic_recent_sends', JSON.stringify(recent));

      setResultData({
        transaction: res.transaction,
        balance_paisa: res.balance_paisa,
        isHeld: res.statusCode === 202 || res.transaction?.state === 'HELD',
      });

      if (res.statusCode !== 202) {
        confetti({ particleCount: 50, spread: 60, origin: { y: 0.6 } });
      }

      await refreshBalance();
      setStep(3);
    } catch (err: any) {
      if (err.status === 403 && err.error === 'STEP_UP_REQUIRED') {
        // Reveal step up inline without clearing state or changing idempotency key
        setRequiresInlineStepUp(true);
        setStepUpError('Please enter your 4-digit PIN to authorize this transfer.');
      } else if (err.status === 402) {
        setApiError(err.message || 'Insufficient funds.');
      } else {
        setApiError(err.message || 'Transfer failed. Please check details and try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-xl mx-auto">
      {/* Progress Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          {step > 1 && step < 3 && (
            <button
              onClick={() => setStep(1)}
              className="p-1 rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors mr-1"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div>
            <h1 className="text-xl font-bold text-on-surface">Send Money</h1>
            <p className="text-xs text-on-surface-variant">Step {step} of 3 — Instant Double-Entry Transfer</p>
          </div>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <span className={`w-6 h-6 rounded-full flex items-center justify-center ${step >= 1 ? 'bg-primary text-white' : 'bg-surface-container text-outline'}`}>
            1
          </span>
          <span className="w-4 h-0.5 bg-outline-variant" />
          <span className={`w-6 h-6 rounded-full flex items-center justify-center ${step >= 2 ? 'bg-primary text-white' : 'bg-surface-container text-outline'}`}>
            2
          </span>
          <span className="w-4 h-0.5 bg-outline-variant" />
          <span className={`w-6 h-6 rounded-full flex items-center justify-center ${step === 3 ? 'bg-emerald-600 text-white' : 'bg-surface-container text-outline'}`}>
            3
          </span>
        </div>
      </div>

      {/* --- STEP 1: RECIPIENT & AMOUNT --- */}
      {step === 1 && (
        <Card className="p-6 space-y-5">
          {/* Quick Select Destination Accounts */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-primary" />
              <span>Select Destination Account:</span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {PERSONAS.filter((p) => p.phone.replace(/\s+/g, '') !== user?.phone.replace(/\s+/g, '')).map((p) => {
                const isSelected = phone.replace(/\s+/g, '') === p.phone.replace(/\s+/g, '');
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPhone(p.phone)}
                    className={`px-2.5 py-1 rounded text-xs transition-all flex items-center gap-1 border ${
                      isSelected
                        ? 'bg-primary text-white border-primary shadow-xs font-semibold'
                        : 'bg-surface-container hover:bg-surface-container-high border-outline-variant text-on-surface'
                    }`}
                  >
                    <span>{p.name.split(' ')[0]}</span>
                    <span className={`text-[10px] ${isSelected ? 'text-primary-fixed' : 'text-on-surface-variant'} font-mono`}>
                      ({p.phone.slice(-4)})
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Recipient Phone Input */}
          <div className="space-y-1.5">
            <Input
              label="Recipient Phone Number"
              type="tel"
              placeholder="+880 171 234 5678"
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

            {/* Resolved Name Chip */}
            {recipient && (
              <div className="p-2.5 rounded bg-surface-container-low border border-outline-variant flex items-center justify-between text-xs animate-in fade-in">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="font-bold text-on-surface">{recipient.name}</span>
                  <span className="text-on-surface-variant font-mono">({recipient.phone})</span>
                </div>
                {recipient.is_first_time && (
                  <span className="text-[10px] font-semibold text-amber-800 bg-amber-100 px-2 py-0.5 rounded border border-amber-300">
                    ⚠ First-time recipient
                  </span>
                )}
              </div>
            )}

            {lookupError && <p className="text-xs text-error font-medium">{lookupError}</p>}
          </div>

          {/* Amount Input */}
          <div className="space-y-1.5">
            <Input
              label="Amount in BDT (৳)"
              type="text"
              placeholder="0.00"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              prefixElement={<span className="font-bold text-primary">৳</span>}
              helperText={`Current Balance: ${formatPaisa(balance)}`}
            />

            {amountPaisa >= 500000 && (
              <div className="p-2.5 rounded bg-surface-container-highest border border-primary-fixed-dim text-xs text-primary flex items-center gap-2">
                <Timer className="w-4 h-4 shrink-0" />
                <span>
                  Transfers of ৳5,000 or above include a <strong>60-second undo grace period</strong>.
                </span>
              </div>
            )}
          </div>

          {/* Note Input */}
          <Input
            label="Optional Note"
            type="text"
            placeholder="e.g. Lunch, project share, rental"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          {apiError && (
            <div className="p-3 rounded bg-rose-50 border border-rose-200 text-xs text-rose-900 font-medium">
              {apiError}
            </div>
          )}

          <Button
            type="button"
            variant="primary"
            size="lg"
            onClick={handleProceedToConfirm}
            disabled={!recipient || amountPaisa <= 0 || !!lookupError}
            className="w-full font-bold py-3 mt-2"
          >
            Review Transfer
          </Button>
        </Card>
      )}

      {/* --- STEP 2: RECIPIENT CONFIRMATION & STEP-UP --- */}
      {step === 2 && recipient && (
        <Card className="p-6 space-y-6">
          <div className="text-center py-4 border-b border-outline-variant space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              You are sending
            </span>
            <div className="font-mono-data text-4xl font-bold text-primary tracking-tight">
              {formatPaisa(amountPaisa)}
            </div>
            <div className="pt-2">
              <span className="text-xs text-on-surface-variant">to</span>
              <h2 className="text-2xl font-bold text-on-surface">{recipient.name}</h2>
              <p className="font-mono text-xs text-on-surface-variant">{recipient.phone}</p>
            </div>
            {note && <p className="text-xs italic text-on-surface-variant mt-2">"{note}"</p>}
          </div>

          {/* Duplicate Send Guard */}
          {isDuplicateSend && (
            <div className="p-3 rounded bg-amber-50 border border-amber-300 text-amber-950 text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-amber-900">
                <AlertTriangle className="w-4 h-4 text-amber-700" />
                <span>Possible Duplicate Transfer Warning</span>
              </div>
              <p>You sent a similar transfer to this number in the last 2 minutes. Please confirm you intend to send again.</p>
            </div>
          )}

          {/* Inline Step-up Challenge */}
          {requiresInlineStepUp && (
            <div className="p-4 rounded-lg bg-surface-container border border-outline-variant space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-primary">
                <Lock className="w-4 h-4" />
                <span>Security Authorization Required</span>
              </div>
              <p className="text-xs text-on-surface-variant">
                {recipient.is_first_time
                  ? 'First-time transfer to this recipient requires PIN authorization.'
                  : 'High-value transfers require account PIN confirmation.'}
              </p>
              <Input
                label="Enter 4-digit PIN"
                type="password"
                maxLength={4}
                placeholder="••••"
                value={stepUpPin}
                onChange={(e) => setStepUpPin(e.target.value.replace(/\D/g, ''))}
                autoFocus
                error={stepUpError || undefined}
              />
            </div>
          )}

          {apiError && (
            <div className="p-3 rounded bg-rose-50 border border-rose-200 text-xs text-rose-900 font-medium">
              {apiError}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="secondary"
              size="lg"
              onClick={() => setStep(1)}
              disabled={isSubmitting}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="lg"
              isLoading={isSubmitting}
              disabled={requiresInlineStepUp && stepUpPin.length !== 4}
              onClick={handleConfirmAndSend}
              className="flex-1 font-bold"
            >
              Confirm & Send
            </Button>
          </div>
        </Card>
      )}

      {/* --- STEP 3: RESULT --- */}
      {step === 3 && resultData && (
        <Card className="p-6 text-center space-y-6 animate-in zoom-in-95">
          <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto shadow-sm">
            <CheckCircle2 className="w-10 h-10" />
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-on-surface">
              {resultData.isHeld ? 'Transfer Scheduled with Hold' : 'Transfer Completed!'}
            </h2>
            <p className="font-mono-data text-3xl font-bold text-primary">
              {formatPaisa(amountPaisa)}
            </p>
            <p className="text-xs text-on-surface-variant">
              Sent to <strong>{recipient?.name}</strong> ({recipient?.phone})
            </p>
          </div>

          {/* New Balance Line */}
          <div className="p-3 rounded bg-surface-container-low border border-outline-variant text-xs flex items-center justify-between">
            <span className="text-on-surface-variant">New Account Balance:</span>
            <span className="font-mono-data font-bold text-sm text-on-surface">
              {formatPaisa(resultData.balance_paisa)}
            </span>
          </div>

          {resultData.isHeld && (
            <div className="p-3 rounded bg-surface-container-highest border border-primary-fixed-dim text-xs text-primary text-left flex items-start gap-2">
              <Timer className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">60-Second Undo Window Active</p>
                <p className="text-[11px] text-on-surface-variant mt-0.5">
                  The transfer can be canceled from your Dashboard for the next 60 seconds before final settlement.
                </p>
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setStep(1);
                setAmountStr('1000');
                setNote('');
              }}
              className="flex-1"
            >
              Send Another
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => router.push('/')}
              className="flex-1 font-bold"
            >
              Back to Dashboard
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
