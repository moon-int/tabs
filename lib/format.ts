export function formatTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

export const stripExt = (name: string | null | undefined) => (name ? name.replace(/\.[^./\\]+$/, '') : '');

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
