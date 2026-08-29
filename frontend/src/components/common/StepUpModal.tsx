import React, { useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Input } from './Input';
import { ShieldAlert, KeyRound } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export function StepUpModal() {
  const { stepUpOpen, stepUpReason, closeStepUp, user } = useAuth();
  const [method, setMethod] = useState<'PIN' | 'TOTP'>('PIN');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code) {
      setError('Please enter your authentication code');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Call POST /auth/step-up with PIN or TOTP method for a real signed token
      const token = await api.stepUp(code, method);
      closeStepUp(token);
      setCode('');
    } catch (err: any) {
      setError(err?.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setCode('');
    setError('');
    closeStepUp(null);
  };

  const getReasonLabel = () => {
    switch (stepUpReason) {
      case 'FIRST_TIME_RECIPIENT':
        return 'First-time recipient security check. Please enter your PIN to proceed.';
      case 'HIGH_VALUE_TRANSFER':
        return 'Transfers above ৳20,000 require security re-authentication.';
      case 'VELOCITY_EXCEEDED':
        return 'High transaction frequency detected. Please re-enter your PIN.';
      default:
        return 'Please confirm your identity with your PIN or TOTP authenticator.';
    }
  };

  return (
    <Modal isOpen={stepUpOpen} onClose={handleCancel} title="Security Verification Required" maxWidth="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-start gap-3 p-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-xs">
          <ShieldAlert className="w-5 h-5 shrink-0 text-amber-700 mt-0.5" />
          <p>{getReasonLabel()}</p>
        </div>

        <div className="flex gap-2 p-1 bg-surface-container rounded border border-outline-variant">
          <button
            type="button"
            onClick={() => setMethod('PIN')}
            className={`flex-1 py-1.5 text-xs font-semibold rounded transition-colors ${
              method === 'PIN' ? 'bg-surface-container-lowest text-primary shadow-xs' : 'text-on-surface-variant'
            }`}
          >
            4-Digit PIN
          </button>
          <button
            type="button"
            onClick={() => setMethod('TOTP')}
            className={`flex-1 py-1.5 text-xs font-semibold rounded transition-colors ${
              method === 'TOTP' ? 'bg-surface-container-lowest text-primary shadow-xs' : 'text-on-surface-variant'
            }`}
          >
            6-Digit TOTP
          </button>
        </div>

        <Input
          label={method === 'PIN' ? 'Account PIN' : 'Authenticator Code'}
          type="password"
          maxLength={method === 'PIN' ? 4 : 6}
          placeholder={method === 'PIN' ? '••••' : '123456'}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          prefixElement={<KeyRound className="w-4 h-4" />}
          error={error}
          autoFocus
        />

        <div className="flex gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={handleCancel} className="flex-1">
            Cancel
          </Button>
          <Button type="submit" variant="primary" isLoading={loading} className="flex-1">
            Confirm
          </Button>
        </div>
      </form>
    </Modal>
  );
}
