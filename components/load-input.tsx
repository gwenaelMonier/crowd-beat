'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parseVideoId } from '@/lib/youtube';

export function LoadInput() {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const videoId = parseVideoId(value);
    if (!videoId) {
      setError('Invalid YouTube URL or ID');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/control', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'load', videoId }),
      });
      if (!res.ok) {
        setError('Failed to load video');
      } else {
        setValue('');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste a YouTube URL or video ID"
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <Button onClick={submit} disabled={loading || !value.trim()}>
          {loading ? 'Loading…' : 'Load'}
        </Button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
