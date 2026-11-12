import { Award, ExternalLink, Globe, Lock, Mail, ShieldCheck, Star, X } from 'lucide-react';
import { useEffect } from 'react';
import { PROFILE, type ProfileLink } from '../config/profile';
import { CHALLENGES } from '../engine/challenges';
import { cx } from '../utils/format';
import { GithubMark } from './icons';

interface Props {
  completed: string[];
  onClose: () => void;
  onOpenMissions: () => void;
}

function LinkIcon({ kind }: { kind: ProfileLink['kind'] }) {
  if (kind === 'github') return <GithubMark size={14} />;
  if (kind === 'email') return <Mail size={14} />;
  if (kind === 'linkedin') return <ExternalLink size={14} />;
  return <Globe size={14} />;
}

/** Stable, human-looking credential number derived from the holder's name. */
function credentialId(name: string): string {
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return `NSA-${(h >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}

/** The reward for clearing every mission: a credential badge and developer profile. */
export function CredentialBadge({ completed, onClose, onOpenMissions }: Props) {
  const unlocked = CHALLENGES.every((c) => completed.includes(c.id));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onPointerDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label="Network Architect Credential">
      <div className="relative max-h-full w-full max-w-[720px] animate-rise overflow-auto rounded-2xl border border-edge-bright bg-panel shadow-2xl shadow-black">
        <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 z-10 rounded p-1.5 text-slate-400 hover:bg-raised hover:text-white">
          <X size={16} />
        </button>

        {!unlocked ? (
          <div className="flex flex-col items-center gap-4 px-8 py-12 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full border border-edge-bright text-slate-500">
              <Lock size={26} />
            </span>
            <div>
              <h2 className="font-mono text-sm font-bold uppercase tracking-[0.2em] text-white">Credential locked</h2>
              <p className="mt-2 max-w-sm text-xs leading-relaxed text-slate-400">Repair all three broken networks in Challenge Missions to unlock the Network Architect credential and the developer profile behind this project.</p>
            </div>
            <div className="w-full max-w-xs space-y-1.5">
              {CHALLENGES.map((c, i) => {
                const done = completed.includes(c.id);
                return (
                  <div key={c.id} className={cx('flex items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-[11px]', done ? 'border-sig-green/40 bg-sig-green/10 text-sig-green' : 'border-edge text-slate-400')}>
                    <span className="font-mono">{done ? '✓' : i + 1}</span>
                    {c.title}
                    <span className="ml-auto font-mono text-[9.5px] uppercase">{done ? 'solved' : 'open'}</span>
                  </div>
                );
              })}
            </div>
            <button onClick={onOpenMissions} className="h-8 rounded-md border border-sig-amber/50 bg-sig-amber/15 px-4 text-xs font-semibold text-sig-amber hover:bg-sig-amber/25">
              Open missions
            </button>
          </div>
        ) : (
          <>
            <div className="relative overflow-hidden border-b border-edge px-7 pb-6 pt-7" style={{ background: 'radial-gradient(120% 140% at 0% 0%, rgba(0,240,255,0.14), transparent 55%), radial-gradient(120% 140% at 100% 0%, rgba(16,185,129,0.14), transparent 55%)' }}>
              <div className="flex items-center gap-5">
                <div className="relative flex h-[88px] w-[88px] shrink-0 items-center justify-center">
                  <svg viewBox="0 0 100 100" className="absolute inset-0 animate-[spin_24s_linear_infinite]" aria-hidden>
                    <circle cx="50" cy="50" r="46" fill="none" stroke="#10b981" strokeWidth="1.5" strokeDasharray="3 5" />
                  </svg>
                  <span className="flex h-[68px] w-[68px] items-center justify-center rounded-full border-2 border-sig-green bg-sig-green/15 text-sig-green shadow-[0_0_30px_rgba(16,185,129,0.45)]">
                    <Award size={32} />
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-sig-green">
                    <ShieldCheck size={12} /> Verified · {CHALLENGES.length}/{CHALLENGES.length} missions
                  </p>
                  <h2 className="mt-1 text-2xl font-bold tracking-tight text-white">Network Architect Credential</h2>
                  <p className="mt-1 text-xs text-slate-400">
                    You diagnosed a subnet mismatch, wrote a firewall ACL and repaired a default route. Here is who built the lab.
                  </p>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-x-6 gap-y-1 font-mono text-[10px] text-slate-500">
                <span>
                  ID <span className="text-slate-300">{credentialId(PROFILE.name)}</span>
                </span>
                <span>
                  ISSUED <span className="text-slate-300">{new Date().toLocaleDateString('en-CA')}</span>
                </span>
                <span>
                  SKILLS <span className="text-slate-300">ARP · IPv4 routing · NAT · ACL</span>
                </span>
              </div>
            </div>

            <div className="grid gap-6 px-7 py-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Developer profile</p>
                <h3 className="mt-1 text-lg font-semibold text-white">{PROFILE.name}</h3>
                <p className="text-xs text-sig-cyan">{PROFILE.title}</p>
                <p className="mt-3 text-[12.5px] leading-relaxed text-slate-300">{PROFILE.bio}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {PROFILE.skills.map((s) => (
                    <span key={s} className="rounded-full border border-edge-bright px-2 py-0.5 text-[10.5px] text-slate-300">
                      {s}
                    </span>
                  ))}
                </div>
                <div className="mt-4 space-y-1.5">
                  {PROFILE.links.map((l) => (
                    <a key={l.url} href={l.url} target={l.kind === 'email' ? undefined : '_blank'} rel="noreferrer" className="flex items-center gap-2 text-xs text-slate-300 transition-colors hover:text-sig-cyan">
                      <LinkIcon kind={l.kind} />
                      {l.label}
                    </a>
                  ))}
                </div>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Selected repositories</p>
                <div className="mt-2 space-y-2">
                  {PROFILE.repos.map((r) => (
                    <a key={r.url} href={r.url} target="_blank" rel="noreferrer" className="group block rounded-lg border border-edge bg-raised/60 p-3 transition-colors hover:border-sig-cyan/50">
                      <p className="flex items-center gap-1.5 font-mono text-xs font-semibold text-white">
                        <Star size={12} className="text-sig-amber" />
                        {r.name}
                        <ExternalLink size={11} className="ml-auto text-slate-600 group-hover:text-sig-cyan" />
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{r.description}</p>
                      <p className="mt-1.5 flex flex-wrap gap-1">
                        {r.tech.map((t) => (
                          <span key={t} className="rounded bg-obsidian px-1.5 py-0.5 font-mono text-[9.5px] text-slate-400">
                            {t}
                          </span>
                        ))}
                      </p>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
