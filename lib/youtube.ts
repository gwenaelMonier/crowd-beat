const ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

export function parseVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (ID_REGEX.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    if (url.hostname === 'youtu.be') {
      const id = url.pathname.slice(1);
      return ID_REGEX.test(id) ? id : null;
    }
    if (/^(?:www\.|m\.)?youtube\.com$/.test(url.hostname)) {
      if (url.pathname === '/watch') {
        const v = url.searchParams.get('v');
        return v && ID_REGEX.test(v) ? v : null;
      }
      if (url.pathname.startsWith('/embed/') || url.pathname.startsWith('/shorts/')) {
        const id = url.pathname.split('/')[2] ?? '';
        return ID_REGEX.test(id) ? id : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}
