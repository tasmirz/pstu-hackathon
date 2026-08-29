'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Card } from '@/components/common/Card';
import { useAuth } from '@/lib/auth-context';
import { ShieldCheck, Lock, Phone, User as UserIcon, Sparkles, AlertTriangle } from 'lucide-react';
import confetti from 'canvas-confetti';

export default function LoginPage() {
  const router = useRouter();
  const { login, register } = useAuth();

  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [phone, setPhone] = useState('+8801712345678');
  const [name, setName] = useState('Rahim Ahmed');
  const [pin, setPin] = useState('1234');
  const [confirmPin, setConfirmPin] = useState('1234');
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [bonusNotification, setBonusNotification] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBonusNotification(null);

    if (tab === 'register') {
      if (pin !== confirmPin) {
        setError('PINs do not match');
        return;
      }
      if (pin.length !== 4) {
        setError('PIN must be 4 digits');
        return;
      }

      setLoading(true);
      try {
        const res = await register(phone, name, pin);
        // Confetti celebration for the ৳100,000 welcome bonus!
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
        });
        setBonusNotification('৳100,000 added to your account');
        setTimeout(() => {
          router.push('/');
        }, 1800);
      } catch (err: any) {
        setError(err.message || 'Registration failed');
      } finally {
        setLoading(false);
      }
    } else {
      // Login
      setLoading(true);
      try {
        await login(phone, pin);
        router.push('/');
      } catch (err: any) {
        if (err.status === 423) {
          setLockedUntil(err.details?.locked_until || '4m');
        } else {
          setError(
            err.details?.attempts_remaining
              ? `${err.message} (${err.details.attempts_remaining} attempts remaining)`
              : err.message || 'Invalid credentials'
          );
        }
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="text-center mb-6">
        <div className="w-12 h-12 rounded-lg bg-primary text-white flex items-center justify-center font-bold text-xl mx-auto mb-3 shadow-sm">
          KL
        </div>
        <h1 className="text-2xl font-bold text-on-surface tracking-tight">Kinetic Ledger</h1>
        <p className="text-xs text-on-surface-variant mt-1">High-integrity Money Movement Platform</p>
      </div>

      <Card className="p-6">
        {/* Tab switch between Login & Register */}
        <div className="flex border-b border-outline-variant pb-3 mb-5 gap-3">
          <button
            type="button"
            onClick={() => {
              setTab('login');
              setError(null);
            }}
            className={`flex-1 py-2 text-sm font-semibold text-center border-b-2 transition-all ${
              tab === 'login'
                ? 'border-primary text-primary'
                : 'border-transparent text-on-surface-variant hover:text-on-surface'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('register');
              setError(null);
            }}
            className={`flex-1 py-2 text-sm font-semibold text-center border-b-2 transition-all ${
              tab === 'register'
                ? 'border-primary text-primary'
                : 'border-transparent text-on-surface-variant hover:text-on-surface'
            }`}
          >
            Create Account
          </button>
        </div>

        {/* 423 Locked State */}
        {lockedUntil ? (
          <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 text-center space-y-2">
            <AlertTriangle className="w-8 h-8 text-rose-700 mx-auto" />
            <h3 className="font-bold text-sm">Too many failed attempts</h3>
            <p className="text-xs">Your account has been temporarily locked for security. Try again in 4 minutes.</p>
            <Button variant="secondary" size="sm" onClick={() => setLockedUntil(null)} className="mt-2">
              Back to Login
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {bonusNotification && (
              <div className="p-3 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-center gap-2 text-xs font-semibold animate-bounce">
                <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{bonusNotification}</span>
              </div>
            )}

            {tab === 'register' && (
              <Input
                label="Full Name"
                type="text"
                placeholder="e.g. Rahim Ahmed"
                value={name}
                onChange={(e) => setName(e.target.value)}
                prefixElement={<UserIcon className="w-4 h-4" />}
                required
              />
            )}

            <Input
              label="Phone Number"
              type="tel"
              placeholder="+8801712345678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              prefixElement={<Phone className="w-4 h-4" />}
              required
            />

            <Input
              label="4-Digit Account PIN"
              type="password"
              maxLength={4}
              placeholder="••••"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              prefixElement={<Lock className="w-4 h-4" />}
              required
            />

            {tab === 'register' && (
              <Input
                label="Confirm PIN"
                type="password"
                maxLength={4}
                placeholder="••••"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                prefixElement={<Lock className="w-4 h-4" />}
                required
              />
            )}

            {error && <p className="text-xs text-error font-medium">{error}</p>}

            <Button type="submit" variant="primary" isLoading={loading} className="w-full mt-2">
              {tab === 'login' ? 'Sign In to Kinetic Ledger' : 'Register & Claim ৳100,000 Bonus'}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
