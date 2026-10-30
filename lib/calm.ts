import React from 'react';

/**
 * React.memo for the session page's side panels (setlist, settings, live tools, groove desk …).
 * The page redraws on every transport update while a song plays; these panels don't change then,
 * but their callback props are fresh arrow functions each time. Callbacks here only ever call the
 * session's stable actions, so they are ignored; plain objects and arrays compare one level deep.
 * Whenever something that matters changes (a value, the role), a value prop changes with it.
 */
export function calm<P extends object>(component: React.ComponentType<P>) {
  return React.memo(component, same);
}

const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype);

function flat(a: Record<string, unknown>, b: Record<string, unknown>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const x = a[k], y = b[k];
    if (x === y || (typeof x === 'function' && typeof y === 'function')) continue;
    return false;
  }
  return true;
}

function same(prev: object, next: object) {
  const a = prev as Record<string, unknown>, b = next as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const x = a[k], y = b[k];
    if (x === y) continue;
    if (typeof x === 'function' && typeof y === 'function') continue;
    if (k !== 'children' && plain(x) && plain(y) && Array.isArray(x) === Array.isArray(y) && flat(x, y)) continue;
    return false;
  }
  return true;
}
