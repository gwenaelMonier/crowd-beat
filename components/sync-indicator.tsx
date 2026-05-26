'use client';

type Props = { driftMs: number; rttMs: number | null };

export function SyncIndicator({ driftMs, rttMs }: Props) {
  const abs = Math.abs(driftMs);
  const color =
    abs < 100 ? 'text-emerald-400' : abs < 500 ? 'text-amber-400' : 'text-red-400';
  const symbol = abs < 100 ? '✓' : abs < 500 ? '~' : '!';
  return (
    <span className={`font-mono text-xs tabular-nums ${color}`}>
      drift {driftMs > 0 ? '+' : ''}
      {driftMs}ms {symbol}
      {rttMs !== null && (
        <span className="ml-2 text-neutral-500">rtt {rttMs}ms</span>
      )}
    </span>
  );
}
