/**
 * Strict Paisa Money Helpers
 * 
 * 1 BDT = 100 Paisa.
 * Every monetary field on the wire is named *_paisa and is an integer.
 * No floats touch the DOM or the network.
 */

export function formatPaisa(paisa: number | null | undefined): string {
  if (paisa === null || paisa === undefined || isNaN(paisa)) {
    return '৳0.00';
  }

  const isNegative = paisa < 0;
  const absPaisa = Math.abs(paisa);
  const taka = Math.floor(absPaisa / 100);
  const remainderPaisa = absPaisa % 100;

  // Format with commas in Bengali/International thousand separators
  const takaFormatted = taka.toLocaleString('en-US');
  const paisaFormatted = remainderPaisa.toString().padStart(2, '0');

  const formatted = `৳${takaFormatted}.${paisaFormatted}`;
  return isNegative ? `−${formatted}` : formatted;
}

export function parseToPaisa(amountStr: string): number {
  if (!amountStr) return 0;

  // Clean characters, allow digits and single dot
  const clean = amountStr.replace(/[^0-9.]/g, '');
  if (!clean) return 0;

  const parts = clean.split('.');
  const taka = parseInt(parts[0] || '0', 10);
  let paisa = 0;

  if (parts.length > 1) {
    const decimalPart = parts[1].padEnd(2, '0').slice(0, 2);
    paisa = parseInt(decimalPart, 10);
  }

  return taka * 100 + paisa;
}

export function formatPaisaCompact(paisa: number): string {
  const abs = Math.abs(paisa);
  const sign = paisa < 0 ? '−' : '';
  if (abs >= 10_000_000_00) {
    return `${sign}৳${(abs / 10_000_000_00).toFixed(1)}Cr`;
  }
  if (abs >= 100_000_00) {
    return `${sign}৳${(abs / 100_000_00).toFixed(1)}L`;
  }
  if (abs >= 1_000_00) {
    return `${sign}৳${(abs / 1_000_00).toFixed(1)}k`;
  }
  return formatPaisa(paisa);
}

export function formatDate(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  } catch {
    return isoString;
  }
}

export function timeAgo(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    const now = Date.now();
    const past = new Date(isoString).getTime();
    const diffSec = Math.floor((now - past) / 1000);

    if (diffSec < 10) return 'just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  } catch {
    return 'recently';
  }
}
