'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { PlaylistTrack } from '@/types/room';

export function PlaylistImport() {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/playlist/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: value }),
      });
      const data = (await res.json()) as { tracks?: PlaylistTrack[]; error?: string };
      if (!res.ok || !data.tracks) {
        setError(data.error ?? 'Failed to import playlist');
        return;
      }
      const loadRes = await fetch('/api/playlist/control', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'loadPlaylist', tracks: data.tracks }),
      });
      if (!loadRes.ok) {
        setError('Failed to start playlist');
        return;
      }
      setValue('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          className="flex-1"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste a YouTube playlist URL"
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <Button className="shrink-0" onClick={submit} disabled={loading || !value.trim()}>
          {loading ? 'Importing…' : 'Load playlist'}
        </Button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
