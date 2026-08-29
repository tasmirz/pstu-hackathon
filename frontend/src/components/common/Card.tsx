import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  variant?: 'default' | 'flat' | 'highlight' | 'warning' | 'error';
}

export function Card({ children, variant = 'default', className, ...props }: CardProps) {
  const baseStyles = 'rounded-md p-5 transition-all';

  const variantStyles = {
    default: 'bg-surface-container-lowest border border-outline-variant shadow-xs',
    flat: 'bg-surface-container-low border border-outline-variant',
    highlight: 'bg-primary-fixed border border-primary-fixed-dim text-on-primary-fixed',
    warning: 'bg-amber-50 border border-amber-200 text-amber-950',
    error: 'bg-rose-50 border border-rose-200 text-rose-950',
  };

  return (
    <div className={twMerge(clsx(baseStyles, variantStyles[variant], className))} {...props}>
      {children}
    </div>
  );
}
