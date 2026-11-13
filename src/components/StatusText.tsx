import React from 'react';

type Tone = 'emerald' | 'amber' | 'crimson' | 'slate' | 'blue';

function getToneForStatus(status: string): Tone {
  switch (status) {
    case 'Confirmation Received':
    case 'Received':
    case 'Confirmed':
    case 'Verified':
    case 'Auto-Applied':
      return 'emerald';
    case 'Response Pending Verification':
    case 'Partially Received':
    case 'Requested':
    case 'Revision Required':
    case 'Needs Verification':
      return 'amber';
    case 'Regret Received':
    case 'No Response':
    case 'Cancelled':
    case 'Duplicate':
      return 'crimson';
    case 'Not Required':
    case 'Awaiting Response':
    case 'Pending':
    case 'Dismissed':
    default:
      return 'slate';
  }
}

const TONE_CLASSES: Record<Tone, { text: string; mark: string }> = {
  emerald: { text: 'text-emerald-800', mark: 'bg-emerald-600' },
  amber: { text: 'text-amber-800', mark: 'bg-amber-600' },
  crimson: { text: 'text-red-800', mark: 'bg-red-600' },
  slate: { text: 'text-slate-600', mark: 'bg-slate-400' },
  blue: { text: 'text-blue-800', mark: 'bg-blue-600' },
};

export const StatusText: React.FC<{
  status: string;
  toneOverride?: Tone;
  className?: string;
}> = ({ status, toneOverride, className = '' }) => {
  const tone = toneOverride ?? getToneForStatus(status);
  const styles = TONE_CLASSES[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${styles.text} ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-xs shrink-0 ${styles.mark}`} aria-hidden="true" />
      <span>{status}</span>
    </span>
  );
};
