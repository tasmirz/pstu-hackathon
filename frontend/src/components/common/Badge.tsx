import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'neutral' | 'success' | 'warning' | 'error' | 'primary' | 'held';
  className?: string;
}

export function Badge({ children, variant = 'neutral', className }: BadgeProps) {
  const baseStyles = 'inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wider';

  const variantStyles = {
    neutral: 'bg-surface-container text-on-surface-variant border border-outline-variant',
    success: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
    warning: 'bg-amber-50 text-amber-900 border border-amber-200',
    error: 'bg-rose-50 text-rose-800 border border-rose-200',
    primary: 'bg-primary-fixed text-on-primary-fixed border border-primary-fixed-dim',
    held: 'bg-amber-100 text-amber-950 border border-amber-300 font-medium',
  };

  return (
    <span className={twMerge(clsx(baseStyles, variantStyles[variant], className))}>
      {children}
    </span>
  );
}
