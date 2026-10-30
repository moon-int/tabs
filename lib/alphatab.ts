import type * as AT from '@coderline/alphatab';
import { at } from './base';

export type AlphaTab = typeof AT;
export type AlphaTabApi = AT.AlphaTabApi;
export type Score = AT.model.Score;
export type Track = AT.model.Track;

declare global {
  interface Window { alphaTab?: AlphaTab }
}

// copied to public/vendor/alphatab by scripts/vendor-alphatab.js (npm install / npm run build)
export const VENDOR = at('/vendor/alphatab/');
export const SCRIPT_FILE = `${VENDOR}alphaTab.min.js`;

let loading: Promise<AlphaTab> | null = null;

/**
 * alphaTab ships web workers and an audio worklet that re-load the very
 * script they came from, which doesn't survive bundling. Loading the
 * prebuilt umd bundle as a plain <script> keeps that working unchanged.
 */
export function loadAlphaTab(): Promise<AlphaTab> {
  if (typeof window === 'undefined') return Promise.reject(new Error('alphaTab needs a browser'));
  if (window.alphaTab) return Promise.resolve(window.alphaTab);
  if (loading) return loading;
  loading = new Promise<AlphaTab>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_FILE;
    s.async = true;
    s.onload = () => (window.alphaTab ? resolve(window.alphaTab) : reject(new Error('alphaTab failed to initialise')));
    s.onerror = () => { loading = null; s.remove(); reject(new Error('could not load alphaTab')); };
    document.head.appendChild(s);
  });
  return loading;
}
