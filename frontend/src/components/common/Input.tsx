import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  prefixElement?: React.ReactNode;
  suffixElement?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, prefixElement, suffixElement, className, id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className="w-full flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
            {label}
          </label>
        )}
        <div
          className={twMerge(
            clsx(
              'flex items-center rounded bg-surface-container-lowest border transition-colors focus-within:ring-1 focus-within:ring-primary focus-within:border-primary',
              error ? 'border-error focus-within:border-error focus-within:ring-error' : 'border-outline-variant hover:border-outline'
            )
          )}
        >
          {prefixElement && <div className="pl-3.5 pr-1 text-on-surface-variant shrink-0">{prefixElement}</div>}
          <input
            ref={ref}
            id={inputId}
            className={twMerge(
              clsx(
                'w-full px-3.5 py-2.5 text-sm bg-transparent text-on-surface placeholder:text-outline focus:outline-none disabled:opacity-50 disabled:bg-surface-container',
                className
              )
            )}
            {...props}
          />
          {suffixElement && <div className="pr-3.5 pl-1 text-on-surface-variant shrink-0">{suffixElement}</div>}
        </div>
        {error ? (
          <p className="text-xs text-error font-medium">{error}</p>
        ) : helperText ? (
          <p className="text-xs text-on-surface-variant">{helperText}</p>
        ) : null}
      </div>
    );
  }
);

Input.displayName = 'Input';
