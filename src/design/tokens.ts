/**
 * Runtime helpers for the DPA design token system.
 *
 * - setMode() flips data-mode on <html>, swapping accents and densities.
 * - applyAlbumAccent() extracts a vibrant color from album artwork and
 *   pushes it into --album-accent (used by Modern Streaming hero surfaces).
 * - resetAlbumAccent() restores the default magenta fallback.
 *
 * Color extraction is intentionally tiny (no library): we sample the image
 * onto a small canvas, bucket pixels by hue, and pick the most saturated
 * non-near-black/near-white bucket.
 */

export type DesignMode = 'streaming' | 'studio';

export function setMode(mode: DesignMode | null): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (mode === null) {
    root.removeAttribute('data-mode');
  } else {
    root.setAttribute('data-mode', mode);
  }
}

export function getMode(): DesignMode | null {
  if (typeof document === 'undefined') return null;
  const m = document.documentElement.getAttribute('data-mode');
  return m === 'streaming' || m === 'studio' ? m : null;
}

const DEFAULT_ALBUM_ACCENT = '#ff4d8d';
const DEFAULT_ALBUM_ACCENT_SOFT = 'rgba(255, 77, 141, 0.16)';
const DEFAULT_ALBUM_ACCENT_GLOW = 'rgba(255, 77, 141, 0.36)';

export function resetAlbumAccent(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--album-accent', DEFAULT_ALBUM_ACCENT);
  root.style.setProperty('--album-accent-soft', DEFAULT_ALBUM_ACCENT_SOFT);
  root.style.setProperty('--album-accent-glow', DEFAULT_ALBUM_ACCENT_GLOW);
}

export function setAlbumAccentFromHex(hex: string): void {
  if (typeof document === 'undefined') return;
  const rgb = hexToRgb(hex);
  if (!rgb) return;
  const root = document.documentElement;
  root.style.setProperty('--album-accent', hex);
  root.style.setProperty('--album-accent-soft', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.16)`);
  root.style.setProperty('--album-accent-glow', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)`);
}

export async function applyAlbumAccent(imageUrl: string | null | undefined): Promise<string | null> {
  if (!imageUrl || typeof document === 'undefined') {
    resetAlbumAccent();
    return null;
  }
  try {
    const accent = await extractAccentFromImage(imageUrl);
    if (accent) {
      setAlbumAccentFromHex(accent);
      return accent;
    }
  } catch {
    // ignore — keep current accent
  }
  return null;
}

async function extractAccentFromImage(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => resolve(null);
    img.onload = () => {
      try {
        const size = 48;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;

        // Bucket by hue (12 buckets), score by saturation * coverage
        const buckets: Array<{ r: number; g: number; b: number; score: number; count: number }> = [];
        for (let i = 0; i < 12; i++) buckets.push({ r: 0, g: 0, b: 0, score: 0, count: 0 });

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 200) continue;
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const lum = (max + min) / 2;
          if (lum < 30 || lum > 240) continue;
          const sat = max === 0 ? 0 : (max - min) / max;
          if (sat < 0.18) continue;
          const hue = rgbToHue(r, g, b);
          const idx = Math.min(11, Math.floor((hue / 360) * 12));
          const bucket = buckets[idx];
          bucket.r += r;
          bucket.g += g;
          bucket.b += b;
          bucket.count += 1;
          bucket.score += sat * 100;
        }

        const winner = buckets.filter(b => b.count > 4).sort((a, b) => b.score - a.score)[0];
        if (!winner) return resolve(null);
        const r = Math.round(winner.r / winner.count);
        const g = Math.round(winner.g / winner.count);
        const b = Math.round(winner.b / winner.count);
        const boosted = boostSaturation(r, g, b);
        return resolve(rgbToHex(boosted.r, boosted.g, boosted.b));
      } catch {
        return resolve(null);
      }
    };
    img.src = url;
  });
}

function rgbToHue(r: number, g: number, b: number): number {
  const rN = r / 255, gN = g / 255, bN = b / 255;
  const max = Math.max(rN, gN, bN), min = Math.min(rN, gN, bN);
  const delta = max - min;
  if (delta === 0) return 0;
  let h = 0;
  if (max === rN) h = ((gN - bN) / delta) % 6;
  else if (max === gN) h = (bN - rN) / delta + 2;
  else h = (rN - gN) / delta + 4;
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  return h;
}

function boostSaturation(r: number, g: number, b: number): { r: number; g: number; b: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const factor = 1.3;
  const newMin = Math.max(0, Math.round(min - (max - min) * (factor - 1) * 0.5));
  const scale = (max - newMin) === 0 ? 1 : (max - min) / (max - newMin || 1);
  void scale;
  return {
    r: Math.min(255, Math.round(r + (r - min) * (factor - 1) * 0.4)),
    g: Math.min(255, Math.round(g + (g - min) * (factor - 1) * 0.4)),
    b: Math.min(255, Math.round(b + (b - min) * (factor - 1) * 0.4)),
  };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => n.toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
