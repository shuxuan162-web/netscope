/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  EDIT ME — this is the only file you need to change to make the site yours.
 *  It feeds the "Network Architect Credential" badge and the header link.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface ProfileLink {
  label: string;
  url: string;
  kind: 'github' | 'email' | 'web' | 'linkedin';
}

export interface ProfileRepo {
  name: string;
  description: string;
  url: string;
  tech: string[];
}

export interface Profile {
  name: string;
  title: string;
  bio: string;
  skills: string[];
  repos: ProfileRepo[];
  links: ProfileLink[];
  /** Shown in the top bar ("View source"). Leave empty to hide it. */
  sourceUrl: string;
}

export const PROFILE: Profile = {
  name: 'Your Name',
  title: 'Full-Stack Engineer · Network Enthusiast',
  bio: 'I build interactive tools that make complex systems easy to see. This simulator is written from scratch in TypeScript — a deterministic event-driven engine models ARP, L2 switching, L3 routing, NAT and stateless ACLs, rendered at 60 FPS with React, SVG and Canvas.',
  skills: ['TypeScript', 'React', 'Networking (L2–L7)', 'Data Visualisation', 'Web Audio', 'System Design'],
  repos: [
    {
      name: 'netscope',
      description: 'This project — a browser-only network topology & packet flow simulator.',
      url: 'https://github.com/shuxuan162-web/netscope',
      tech: ['TypeScript', 'React', 'Tailwind'],
    },
    {
      name: 'your-second-project',
      description: 'Describe another repository you are proud of.',
      url: 'https://github.com/shuxuan162-web',
      tech: ['Tech', 'Stack'],
    },
  ],
  links: [
    { label: 'github.com/shuxuan162-web', url: 'https://github.com/shuxuan162-web', kind: 'github' },
    { label: 'you@your-domain.com', url: 'mailto:you@your-domain.com', kind: 'email' },
    { label: 'your-domain.com', url: 'https://your-domain.com', kind: 'web' },
  ],
  sourceUrl: 'https://github.com/shuxuan162-web/netscope',
};
