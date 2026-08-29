'use client';

import React from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { ShieldAlert, ArrowLeft, Lock } from 'lucide-react';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user || user.role !== 'ADMIN') {
    return (
      <div className="max-w-md mx-auto py-12 px-4">
        <Card className="p-6 text-center space-y-4 border-red-200 bg-red-50/50">
          <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-on-surface">Access Denied (403)</h2>
            <p className="text-xs text-on-surface-variant mt-1">
              This area is restricted to System Administrators. Your current role is <strong className="text-red-700 font-mono">{user?.role || 'GUEST'}</strong>.
            </p>
          </div>
          <div className="p-3 bg-surface-container rounded border border-outline-variant text-[11px] text-left space-y-1">
            <p className="font-semibold text-on-surface">Need Admin Access for testing?</p>
            <p className="text-on-surface-variant">
              Use the <strong>Demo Persona</strong> switcher in the top bar to switch to <strong>System Admin</strong>.
            </p>
          </div>
          <Link href="/" className="inline-block w-full">
            <Button variant="secondary" className="w-full">
              <ArrowLeft className="w-4 h-4 mr-1.5" />
              Return to Dashboard
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
