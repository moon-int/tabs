"use client";
import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { BASE, at } from '../lib/base';

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/;

/**
 * The invite link as text and qr code. A host who opened tabs on its own
 * laptop sees "localhost" in the address bar — useless for the band — so
 * the link then uses the laptop's addresses in the local network instead
 * (GET /api/lan), and the band joins in the same wifi.
 */
export default function Invite({ roomId, onClose, onCopied }: { roomId: string; onClose: () => void; onCopied: (msg: string) => void }) {
  const [bases, setBases] = useState<string[] | null>(null);
  const [base, setBase] = useState('');
  const [svg, setSvg] = useState('');
  const loopback = typeof window !== 'undefined' && LOOPBACK.test(window.location.hostname);

  useEffect(() => {
    if (!loopback) { setBases([window.location.origin + BASE]); setBase(window.location.origin + BASE); return; }
    fetch(at('/api/lan'))
      .then(r => (r.ok ? r.json() : { urls: [] }))
      .then(({ urls }: { urls: string[] }) => { setBases(urls); setBase(urls[0] ?? ''); })
      .catch(() => setBases([]));
  }, [loopback]);

  const link = base ? `${base}/room/${roomId}` : '';
  useEffect(() => {
    if (!link) { setSvg(''); return; }
    // dark on white whatever the theme — phone cameras read that best
    QRCode.toString(link, { type: 'svg', margin: 2, color: { dark: '#000000', light: '#ffffff' } }).then(setSvg).catch(() => setSvg(''));
  }, [link]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); onCopied('invite link copied'); }
    catch { window.prompt('copy this link', link); }
  };

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel overlay-card invite" role="dialog" aria-label="invite the band">
        <h2>invite the band <span className="mono" style={{ color: 'var(--mint)' }}>{roomId}</span></h2>
        {bases === null ? <p>looking for this computer in the network…</p> : !link ? (
          <p>this computer has no network address the band could reach. connect it to the rehearsal wifi (or open a hotspot) and try again.</p>
        ) : (
          <>
            {svg && <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} />}
            <p>{loopback ? 'scan with the phone camera — everyone has to be in the same wifi as this computer.' : 'scan with the phone camera, or send the link.'}</p>
            {bases.length > 1 && (
              <select className="btn sm" value={base} onChange={e => setBase(e.target.value)} aria-label="network">
                {bases.map(b => <option key={b} value={b}>{b.replace(/^https?:\/\//, '')}</option>)}
              </select>
            )}
            <button className="invite-link mono" onClick={copy} title="copy">{link.replace(/^https?:\/\//, '')}</button>
            {loopback && <p style={{ fontSize: 12 }}>nobody gets in? the firewall may block node — allow it for private networks.</p>}
          </>
        )}
        <div className="row">
          {link && <button className="btn primary" onClick={copy}>copy link</button>}
          <button className="btn" onClick={onClose}>close</button>
        </div>
      </div>
    </div>
  );
}
