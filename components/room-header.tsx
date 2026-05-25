'use client';

type Props = { listenerCount: number };

export function RoomHeader({ listenerCount }: Props) {
  return (
    <header className="flex w-full items-center justify-between">
      <h1 className="text-xl font-semibold tracking-tight">🔊 Collective Speaker</h1>
      <div className="text-sm text-neutral-400">👥 {listenerCount} listening</div>
    </header>
  );
}
