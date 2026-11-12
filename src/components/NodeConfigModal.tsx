import { ArrowDown, ArrowUp, MousePointer2, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { formatRule, serviceName } from '../engine/describe';
import { isValidAddrPattern, isValidIp, isValidMac, isValidPortPattern, networkOf, parseCidr, prefixToMask } from '../engine/ip';
import type { NetworkEngine } from '../engine/networkEngine';
import { useEngineVersion } from '../hooks/useEngine';
import type { ACLRule, NetInterface, NetworkNode } from '../types/network';
import { cx } from '../utils/format';
import { KIND_META } from './nodeMeta';

const inputCls = 'h-7 w-full rounded border bg-obsidian px-2 font-mono text-[11px] text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-sig-cyan/70';
const selectCls = 'h-7 rounded border border-edge bg-obsidian px-1.5 font-mono text-[11px] text-slate-100 outline-none focus:border-sig-cyan/70';

interface FieldProps {
  value: string;
  onCommit: (v: string) => void;
  /** Returns an error message, or null when the draft is acceptable. */
  validate?: (v: string) => string | null;
  placeholder?: string;
  label?: string;
  className?: string;
  upper?: boolean;
}

/** Text input that keeps a local draft and only commits valid values to the engine. */
function Field({ value, onCommit, validate, placeholder, label, className, upper }: FieldProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const error = validate ? validate(draft) : null;
  return (
    <input
      value={draft}
      spellCheck={false}
      placeholder={placeholder}
      aria-label={label}
      aria-invalid={!!error}
      title={error ?? label}
      onChange={(e) => {
        const v = upper ? e.target.value.toUpperCase() : e.target.value;
        setDraft(v);
        if (!validate || !validate(v)) onCommit(v.trim());
      }}
      onBlur={() => error && setDraft(value)}
      className={cx(inputCls, error ? 'border-sig-red/80 text-sig-red' : 'border-edge', className)}
    />
  );
}

function Section({ title, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-edge bg-raised/50">
      <header className="flex items-center gap-2 border-b border-edge px-3 py-1.5">
        <h3 className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-slate-300">{title}</h3>
        {hint && <span className="truncate text-[10px] text-slate-500">{hint}</span>}
        <span className="ml-auto">{action}</span>
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

function Labeled({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</span>
      {children}
    </label>
  );
}

const smallBtn = 'flex h-6 items-center gap-1 rounded border border-edge bg-raised px-2 text-[10px] font-semibold text-slate-300 hover:border-sig-cyan/50 hover:text-sig-cyan';
const iconBtn = 'flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-white/10 hover:text-white disabled:opacity-25 disabled:hover:bg-transparent';

const ipOrEmpty = (v: string) => (v.trim() === '' || isValidIp(v.trim()) ? null : 'Enter a valid IPv4 address');
const ipRequired = (v: string) => (isValidIp(v.trim()) ? null : 'Enter a valid IPv4 address');

function InterfaceRow({ engine, node, iface, layer3 }: { engine: NetworkEngine; node: NetworkNode; iface: NetInterface; layer3: boolean }) {
  const peer = (() => {
    const link = engine.link(iface.linkId);
    if (!link) return null;
    const other = link.a.nodeId === node.id ? link.b : link.a;
    return engine.node(other.nodeId)?.hostname ?? null;
  })();
  return (
    <div className="grid grid-cols-[64px_minmax(0,1.3fr)_minmax(0,1.5fr)_minmax(0,1.4fr)_minmax(0,1fr)] items-center gap-2">
      <span className="font-mono text-[11px] font-semibold text-slate-200">{iface.name}</span>
      {layer3 ? (
        <>
          <Field label={`${iface.name} IP address`} value={iface.ip} placeholder="unassigned" validate={ipOrEmpty} onCommit={(v) => engine.mutate(() => (iface.ip = v))} />
          <select
            aria-label={`${iface.name} subnet mask`}
            value={iface.prefix}
            onChange={(e) => engine.mutate(() => (iface.prefix = Number(e.target.value)))}
            className={cx(selectCls, 'w-full')}
          >
            {Array.from({ length: 25 }, (_, i) => i + 8).map((p) => (
              <option key={p} value={p}>
                /{p} — {prefixToMask(p)}
              </option>
            ))}
          </select>
        </>
      ) : (
        <span className="col-span-2 font-mono text-[10px] text-slate-500">Layer-2 port — no IP address</span>
      )}
      <Field label={`${iface.name} MAC address`} value={iface.mac} upper validate={(v) => (isValidMac(v.trim()) ? null : 'Format: AA:BB:CC:DD:EE:FF')} onCommit={(v) => engine.mutate(() => (iface.mac = v))} />
      <span className={cx('truncate font-mono text-[10px]', peer ? 'text-sig-green' : 'text-slate-600')}>{peer ? `⇄ ${peer}` : 'not connected'}</span>
    </div>
  );
}

function AclEditor({ engine, node }: { engine: NetworkEngine; node: NetworkNode }) {
  const edit = (fn: () => void) => engine.mutate(fn, false);
  const patch = (r: ACLRule, p: Partial<ACLRule>) => edit(() => Object.assign(r, p));
  const move = (i: number, d: -1 | 1) =>
    edit(() => {
      const [r] = node.acl.splice(i, 1);
      node.acl.splice(i + d, 0, r);
    });
  const addr = (v: string) => (isValidAddrPattern(v) ? null : 'ANY, an IP, or CIDR (10.0.0.0/24)');
  const port = (v: string) => (isValidPortPattern(v) ? null : 'ANY or 1-65535');

  return (
    <Section
      title="Firewall ACL"
      hint="stateless · evaluated top-down · first match wins"
      action={
        <button
          className={smallBtn}
          onClick={() => edit(() => node.acl.push({ id: engine.newRuleId(), action: 'DENY', protocol: 'TCP', src: 'ANY', srcPort: 'ANY', dst: 'ANY', dstPort: '22', enabled: false }))}
          title="Adds a disabled rule — edit it, then tick the checkbox to enable"
        >
          <Plus size={11} /> Add rule
        </button>
      }
    >
      <div className="space-y-1.5">
        <div className="grid grid-cols-[18px_22px_78px_68px_minmax(0,1.5fr)_56px_minmax(0,1.5fr)_56px_72px] gap-1.5 text-[9px] font-medium uppercase tracking-wider text-slate-500">
          <span />
          <span>#</span>
          <span>Action</span>
          <span>Proto</span>
          <span>Source</span>
          <span>S.port</span>
          <span>Destination</span>
          <span>D.port</span>
          <span />
        </div>
        {node.acl.map((r, i) => (
          <div key={r.id} className={cx('grid grid-cols-[18px_22px_78px_68px_minmax(0,1.5fr)_56px_minmax(0,1.5fr)_56px_72px] items-center gap-1.5', !r.enabled && 'opacity-50')} title={formatRule(r)}>
            <input type="checkbox" checked={r.enabled} onChange={(e) => patch(r, { enabled: e.target.checked })} aria-label={`Enable rule ${i + 1}`} className="accent-[#00f0ff]" />
            <span className="font-mono text-[11px] text-slate-400">{i + 1}</span>
            <select aria-label={`Rule ${i + 1} action`} value={r.action} onChange={(e) => patch(r, { action: e.target.value as ACLRule['action'] })} className={cx(selectCls, 'font-bold', r.action === 'DENY' ? '!text-sig-red' : '!text-sig-green')}>
              <option>ALLOW</option>
              <option>DENY</option>
            </select>
            <select aria-label={`Rule ${i + 1} protocol`} value={r.protocol} onChange={(e) => patch(r, { protocol: e.target.value as ACLRule['protocol'] })} className={selectCls}>
              <option>ANY</option>
              <option>TCP</option>
              <option>UDP</option>
              <option>ICMP</option>
            </select>
            <Field label={`Rule ${i + 1} source`} value={r.src} validate={addr} onCommit={(v) => patch(r, { src: v })} />
            <Field label={`Rule ${i + 1} source port`} value={r.srcPort} upper validate={port} onCommit={(v) => patch(r, { srcPort: v })} />
            <Field label={`Rule ${i + 1} destination`} value={r.dst} validate={addr} onCommit={(v) => patch(r, { dst: v })} />
            <Field label={`Rule ${i + 1} destination port`} value={r.dstPort} upper validate={port} onCommit={(v) => patch(r, { dstPort: v })} />
            <span className="flex justify-end">
              <button className={iconBtn} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move rule up" title="Move up">
                <ArrowUp size={12} />
              </button>
              <button className={iconBtn} disabled={i === node.acl.length - 1} onClick={() => move(i, 1)} aria-label="Move rule down" title="Move down">
                <ArrowDown size={12} />
              </button>
              <button className={cx(iconBtn, 'hover:!text-sig-red')} onClick={() => edit(() => node.acl.splice(i, 1))} aria-label="Delete rule" title="Delete rule">
                <Trash2 size={12} />
              </button>
            </span>
          </div>
        ))}
        <p className="font-mono text-[10px] text-slate-500">
          #{node.acl.length + 1} <span className="text-sig-green">ALLOW</span> ANY ANY:ANY → ANY:ANY <span className="text-slate-600">— implicit default when nothing matches</span>
        </p>
      </div>
    </Section>
  );
}

function RuntimeTable({ title, empty, rows }: { title: string; empty: string; rows: [string, string][] }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
        {title} <span className="text-slate-600">({rows.length})</span>
      </p>
      {rows.length === 0 ? (
        <p className="font-mono text-[10px] text-slate-600">{empty}</p>
      ) : (
        <div className="space-y-0.5">
          {rows.map(([a, b], i) => (
            <div key={i} className="flex justify-between gap-3 rounded bg-obsidian/70 px-2 py-0.5 font-mono text-[10.5px]">
              <span className="text-slate-200">{a}</span>
              <span className="text-sig-cyan">{b}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  engine: NetworkEngine;
  nodeId: string | null;
  onDeleted: () => void;
}

/** Real-time property, routing, ACL and service editor for the selected node. */
export function NodeConfigModal({ engine, nodeId, onDeleted }: Props) {
  useEngineVersion(engine);
  const node = nodeId ? engine.node(nodeId) : undefined;
  const [newPort, setNewPort] = useState('8080');

  if (!node) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <MousePointer2 size={20} className="text-slate-600" />
        <p className="text-xs text-slate-400">Click any node on the canvas to configure it.</p>
        <p className="max-w-sm text-[11px] text-slate-600">Hostname, IP / CIDR, MAC, subnet mask, gateway, static routes, firewall rules, NAT and listening services are all editable while the simulation runs.</p>
      </div>
    );
  }

  const meta = KIND_META[node.kind];
  const endHost = node.kind === 'host' || node.kind === 'server';
  const l3Forwarder = node.kind === 'router' || node.kind === 'firewall';
  const ifaceName = (id: string) => node.interfaces.find((i) => i.id === id)?.name ?? '?';
  const portNum = Number(newPort);
  const portOk = /^\d{1,5}$/.test(newPort) && portNum >= 1 && portNum <= 65535;

  return (
    <div className="h-full overflow-auto p-3">
      <div className="mx-auto grid max-w-[1500px] grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="space-y-3">
          <Section
            title="Identity"
            hint={meta.label}
            action={
              <button
                className={cx(smallBtn, 'hover:!border-sig-red/60 hover:!text-sig-red')}
                onClick={() => {
                  engine.removeNode(node.id);
                  onDeleted();
                }}
              >
                <Trash2 size={11} /> Delete node
              </button>
            }
          >
            <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-end gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg border" style={{ borderColor: meta.color, background: `${meta.color}14` }}>
                <meta.Icon size={20} color={meta.color} />
              </span>
              <Labeled label="Hostname">
                <Field label="Hostname" value={node.hostname} validate={(v) => (/^[\w.-]{1,24}$/.test(v.trim()) ? null : '1-24 letters, digits, - _ .')} onCommit={(v) => engine.mutate(() => (node.hostname = v), false)} />
              </Labeled>
              {endHost ? (
                <Labeled label="Default gateway">
                  <Field label="Default gateway" value={node.gateway} placeholder="none" validate={ipOrEmpty} onCommit={(v) => engine.mutate(() => (node.gateway = v))} />
                </Labeled>
              ) : (
                <p className="pb-1.5 text-[11px] text-slate-500">{node.kind === 'switch' ? 'Forwards frames by destination MAC; floods broadcasts and unknown unicasts.' : 'Routes by longest-prefix match and decrements TTL on every hop.'}</p>
              )}
            </div>
          </Section>

          <Section title={node.kind === 'switch' ? 'Ports' : 'Interfaces'} hint={l3Forwarder ? 'one interface is created per link' : undefined}>
            {node.interfaces.length === 0 ? (
              <p className="text-[11px] text-slate-500">No {node.kind === 'switch' ? 'ports' : 'interfaces'} yet — connect this node with the cable tool (C) to create one.</p>
            ) : (
              <div className="space-y-1.5">
                <div className="grid grid-cols-[64px_minmax(0,1.3fr)_minmax(0,1.5fr)_minmax(0,1.4fr)_minmax(0,1fr)] gap-2 text-[9px] font-medium uppercase tracking-wider text-slate-500">
                  <span>Name</span>
                  <span>IP address</span>
                  <span>Subnet mask (CIDR)</span>
                  <span>MAC address</span>
                  <span>Link</span>
                </div>
                {node.interfaces.map((i) => (
                  <InterfaceRow key={i.id} engine={engine} node={node} iface={i} layer3={node.kind !== 'switch'} />
                ))}
              </div>
            )}
          </Section>

          {l3Forwarder && (
            <Section
              title="Static routes"
              hint="connected networks are added automatically"
              action={
                <span className="flex gap-1.5">
                  {!node.routes.some((r) => parseCidr(r.destination)?.prefix === 0) && (
                    <button className={smallBtn} onClick={() => engine.mutate(() => node.routes.push({ id: engine.newRuleId(), destination: '0.0.0.0/0', nextHop: '' }), false)}>
                      <Plus size={11} /> Default route
                    </button>
                  )}
                  <button className={smallBtn} onClick={() => engine.mutate(() => node.routes.push({ id: engine.newRuleId(), destination: '10.0.0.0/24', nextHop: '' }), false)}>
                    <Plus size={11} /> Add route
                  </button>
                </span>
              }
            >
              <div className="space-y-1.5">
                {node.interfaces
                  .filter((i) => i.ip)
                  .map((i) => (
                    <div key={i.id} className="grid grid-cols-[22px_minmax(0,1fr)_minmax(0,1fr)_28px] items-center gap-2 font-mono text-[11px] text-slate-500">
                      <span className="font-bold text-sig-green">C</span>
                      <span>
                        {networkOf(i.ip, i.prefix)}/{i.prefix}
                      </span>
                      <span>directly connected, {i.name}</span>
                      <span />
                    </div>
                  ))}
                {node.routes.map((r) => {
                  const reachable = isValidIp(r.nextHop) && node.interfaces.some((i) => i.ip && parseCidr(`${i.ip}/${i.prefix}`) && networkOf(r.nextHop, i.prefix) === networkOf(i.ip, i.prefix));
                  return (
                    <div key={r.id} className="grid grid-cols-[22px_minmax(0,1fr)_minmax(0,1fr)_28px] items-center gap-2">
                      <span className="font-mono text-[11px] font-bold text-sig-cyan" title="Static route">
                        S
                      </span>
                      <Field label="Route destination" value={r.destination} placeholder="0.0.0.0/0" validate={(v) => (parseCidr(v) && v.includes('/') ? null : 'CIDR network, e.g. 0.0.0.0/0')} onCommit={(v) => engine.mutate(() => (r.destination = v), false)} />
                      <Field
                        label="Route next hop"
                        value={r.nextHop}
                        placeholder="next-hop IP"
                        validate={ipRequired}
                        onCommit={(v) => engine.mutate(() => (r.nextHop = v), false)}
                        className={r.nextHop && !reachable ? '!border-sig-amber/70' : undefined}
                      />
                      <button className={cx(iconBtn, 'hover:!text-sig-red')} onClick={() => engine.mutate(() => (node.routes = node.routes.filter((x) => x.id !== r.id)), false)} aria-label="Delete route" title="Delete route">
                        <Trash2 size={12} />
                      </button>
                      {r.nextHop && !reachable && <p className="col-span-4 -mt-1 pl-[30px] text-[10px] text-sig-amber">Next hop is not on a connected subnet — this route is inactive.</p>}
                    </div>
                  );
                })}
                {node.routes.length === 0 && <p className="text-[11px] text-slate-500">No static routes. Traffic to unknown networks is dropped until a route (e.g. a default route 0.0.0.0/0) exists.</p>}
              </div>
            </Section>
          )}

          {endHost && (
            <Section title="Listening services" hint="open ports answer SYN with SYN-ACK; closed ports reply RST">
              <div className="flex flex-wrap items-center gap-1.5">
                {node.services.map((s) => (
                  <span key={`${s.protocol}${s.port}`} className="flex items-center gap-1.5 rounded border border-sig-green/40 bg-sig-green/10 py-0.5 pl-2 pr-1 font-mono text-[11px] text-sig-green">
                    {s.port}/{s.protocol.toLowerCase()} <span className="text-slate-400">{s.name}</span>
                    <button className="rounded p-0.5 text-slate-500 hover:text-sig-red" aria-label={`Close port ${s.port}`} onClick={() => engine.mutate(() => (node.services = node.services.filter((x) => x !== s)), false)}>
                      <Trash2 size={10} />
                    </button>
                  </span>
                ))}
                {node.services.length === 0 && <span className="text-[11px] text-slate-500">No open ports.</span>}
                <span className="ml-auto flex items-center gap-1.5">
                  <input value={newPort} onChange={(e) => setNewPort(e.target.value)} aria-label="New port number" className={cx(inputCls, 'w-16', portOk ? 'border-edge' : 'border-sig-red/80')} />
                  {(['TCP', 'UDP'] as const).map((proto) => (
                    <button
                      key={proto}
                      className={smallBtn}
                      disabled={!portOk || node.services.some((s) => s.port === portNum && s.protocol === proto)}
                      onClick={() => engine.mutate(() => node.services.push({ port: portNum, protocol: proto, name: serviceName(portNum, proto) }), false)}
                    >
                      <Plus size={11} /> {proto}
                    </button>
                  ))}
                </span>
              </div>
            </Section>
          )}
        </div>

        <div className="space-y-3">
          {node.kind === 'firewall' && (
            <>
              <AclEditor engine={engine} node={node} />
              <Section title="Source NAT (PAT)" hint="translate private addresses to one public IP on egress">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-300">
                    <input type="checkbox" checked={node.nat.enabled} onChange={(e) => engine.mutate(() => (node.nat.enabled = e.target.checked))} className="accent-[#00f0ff]" />
                    Enable NAT overload
                  </label>
                  <label className="flex items-center gap-2 text-[11px] text-slate-400">
                    Outside (WAN) interface
                    <select value={node.nat.outsideIfaceId ?? ''} onChange={(e) => engine.mutate(() => (node.nat.outsideIfaceId = e.target.value || null))} className={selectCls} aria-label="NAT outside interface">
                      <option value="">— none —</option>
                      {node.interfaces.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name} {i.ip && `(${i.ip})`}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </Section>
            </>
          )}

          <Section
            title="Live state"
            hint="learned while traffic flows"
            action={
              <button className={smallBtn} onClick={() => engine.flushTables()}>
                Flush all tables
              </button>
            }
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {node.kind === 'switch' ? (
                <RuntimeTable title="MAC address table" empty="Empty — the switch floods until it learns source MACs." rows={node.macTable.map((m) => [m.mac, `port ${ifaceName(m.portId)}`])} />
              ) : (
                <RuntimeTable title="ARP cache" empty="Empty — the first packet will trigger an ARP broadcast." rows={node.arpTable.map((a) => [a.ip, a.mac])} />
              )}
              {node.kind === 'firewall' && (
                <RuntimeTable title="NAT translations" empty="No active translations." rows={node.natTable.map((e) => [`${e.protocol} ${e.insideIp}:${e.insidePort}`, `${e.publicIp}:${e.publicPort}`])} />
              )}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
