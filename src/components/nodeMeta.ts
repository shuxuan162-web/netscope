import { BrickWallShield, EthernetPort, Monitor, Router, Server, type LucideIcon } from 'lucide-react';
import type { NodeKind, NodeStatus } from '../types/network';

export const SIGNAL = {
  cyan: '#00f0ff',
  green: '#10b981',
  red: '#f43f5e',
  amber: '#f59e0b',
} as const;

export const KIND_META: Record<NodeKind, { label: string; short: string; color: string; Icon: LucideIcon }> = {
  host: { label: 'Host / Client PC', short: 'Host', color: '#38bdf8', Icon: Monitor },
  switch: { label: 'Switch (Layer 2)', short: 'Switch', color: '#a78bfa', Icon: EthernetPort },
  router: { label: 'Router / Gateway (Layer 3)', short: 'Router', color: '#818cf8', Icon: Router },
  firewall: { label: 'Firewall / NAT Appliance', short: 'Firewall', color: '#fb923c', Icon: BrickWallShield },
  server: { label: 'Web Server / Service Host', short: 'Server', color: '#34d399', Icon: Server },
};

export const NODE_KINDS: NodeKind[] = ['host', 'switch', 'router', 'firewall', 'server'];

export const STATUS_COLOR: Record<NodeStatus, string> = {
  online: SIGNAL.green,
  inspecting: SIGNAL.cyan,
  dropping: SIGNAL.red,
  saturated: SIGNAL.amber,
};
