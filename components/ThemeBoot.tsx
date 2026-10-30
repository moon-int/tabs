"use client";
import { useEffect } from 'react';
import { loadPrefs } from '../lib/prefs';
import { applyTheme, resolveTheme } from '../lib/themes';

/** applies the saved theme on every page; the session page re-applies live as it changes */
export default function ThemeBoot() {
  useEffect(() => {
    const p = loadPrefs();
    applyTheme(resolveTheme(p.theme.id, p.theme.accent, p.view.paper), p.view.paper);
  }, []);
  return null;
}
