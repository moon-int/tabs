"use client";
import React from 'react';
import { SIGN_OUT_URL, signInUrl, type Me } from '../lib/account';

/** signed in as … · sign out — or the way in */
export default function AccountChip({ user }: { user: Me | null }) {
  if (!user) return <a className="btn sm primary" href={signInUrl()}>sign in with havoc</a>;
  return (
    <span className="account">
      <span className={`chip ${user.admin ? 'mint' : ''}`} title={`${user.email} · havoc role: ${user.role}`}>
        {user.name}{user.admin ? ' · admin' : ''}
      </span>
      <a className="btn sm ghost" href={SIGN_OUT_URL} title="sign out of tabs and havoc">sign out</a>
    </span>
  );
}
