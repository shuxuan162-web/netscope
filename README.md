# NetScope — Interactive Network Topology & Packet Flow Simulator

Build a network, launch traffic, and watch every frame travel hop by hop: ARP broadcasts flooding a switch, a TCP three-way handshake crossing a router, a firewall bursting a denied packet into red. A Wireshark-style inspector dissects each frame down to real wire bytes.

Runs **100% in the browser** — no backend, no API, no tracking. The production build is a folder of static files.

## Features

- **Interactive canvas** — drag devices from the palette (or click-to-place), connect them with the cable tool, pan, zoom, auto-fit. SVG nodes and bezier links, with packets rendered on a canvas overlay at 60 FPS. No graph or canvas library.
- **Five device types** — Host, L2 Switch, L3 Router, Firewall/NAT appliance, Server.
- **A real protocol engine** (`src/engine/networkEngine.ts`), deterministic and event-driven:
  - ARP request/reply with per-node caches, retries and timeouts; duplicate-IP conflict detection
  - Switch MAC learning, flooding of broadcasts/unknown unicasts, known-unicast forwarding
  - Longest-prefix-match routing, connected + static + default routes, TTL decrement, ICMP Time Exceeded / Destination Unreachable
  - Stateless first-match ACLs and source NAT (PAT) with a translation table
  - ICMP echo, TCP handshake + application exchange (HTTP, SSH, TLS, MySQL), UDP DNS, RST on closed ports
  - Seeded packet loss, so a given loss rate always replays the same way
- **Packet Inspector** — chronological capture of every frame on every link. Select one for an OSI breakdown (L2 Ethernet, L3 IPv4/ARP, L4 ICMP/TCP/UDP, L7 payload) cross-highlighted against a hex dump. Frames are serialised to real bytes with valid IPv4/TCP/UDP/ICMP checksums.
- **Node configuration** — hostname, IP/CIDR, subnet mask, MAC, gateway, static routes, ACL rules, NAT, listening ports; edits apply live.
- **Terminal** — live trace of hop decisions, route lookups and ARP/MAC/NAT state, plus a small CLI (`ping PC-A 10.0.0.5`, `show route R1`, `show arp PC-A`, `help`).
- **Scenarios** — Basic LAN to Web Server · NAT Gateway & DMZ · Firewall ACL Block (22/80) · ARP Resolution & Collision · Empty Sandbox.
- **Challenge Missions** — three broken networks to diagnose and repair (subnet mismatch, firewall rule, missing default route). Solving all three unlocks the **Network Architect Credential** with the author's profile.
- **Audio** — synthesised with the Web Audio API (no audio files); mutable.

Keyboard: `Space` play/pause · `.` step · `V` select · `C` connect · `F` fit view · `Del` delete selected node · `Esc` cancel.

## Make it yours

Edit **`src/config/profile.ts`** — name, bio, skills, repositories and contact links. That one file feeds the credential badge and the "view source" link in the header.

## Run locally

Requires Node 20+.

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm test         # engine test-suite (Vitest)
npm run build    # type-check + production build into dist/
npm run preview  # serve the production build locally
```

## Deploy

The build uses relative asset URLs (`base: './'` in `vite.config.ts`), so the same `dist/` works on a domain root **and** on a sub-path such as `username.github.io/repo/` without any configuration.

### GitHub Pages (included workflow)

1. Push this repository to GitHub with `main` as the default branch.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Every push to `main` runs `.github/workflows/deploy.yml` (tests → build → deploy).

### Custom domain on GitHub Pages

1. **Settings → Pages → Custom domain** → enter your domain and save.
2. At your DNS provider add:
   - **Subdomain** (`www.example.com` or `netscope.example.com`): a `CNAME` record pointing to `<your-username>.github.io`.
   - **Apex** (`example.com`): four `A` records to `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`.
3. Once the DNS check passes, tick **Enforce HTTPS**.

With the Actions-based deployment the domain is stored in the repository settings, so no `CNAME` file is needed in the repo.

### Vercel / Cloudflare Pages / Netlify

Import the repository and use: build command `npm run build`, output directory `dist`. Add your domain in the host's dashboard. There is no client-side routing, so no rewrite rules are required.

## Project layout

```
src/
  types/network.ts          NetworkNode, Link, Packet, OSIFrame, RoutingEntry, ARPEntry, ACLRule …
  engine/
    networkEngine.ts        the simulator: clock, ARP, switching, routing, ACL, NAT, L4-L7
    networkEngine.test.ts   behaviour tests for every scenario and mission
    scenarios.ts            preset and mission topologies
    challenges.ts           mission briefs, hints and pass criteria
    commands.ts             terminal CLI
    describe.ts, ip.ts      frame summaries, IPv4/CIDR math
  components/
    Canvas.tsx              topology editor (SVG) + pan/zoom/drag/link
    canvasRenderer.ts       60 FPS packet / effect overlay (Canvas 2D)
    PacketInspector.tsx     capture list, header tree, hex dump
    NodeConfigModal.tsx     live property, routing, ACL and NAT editor
    TerminalConsole.tsx     trace log + CLI
    TrafficPanel.tsx, TopBar.tsx, Dock.tsx, MissionsDrawer.tsx, CredentialBadge.tsx
  utils/
    audio.ts                Web Audio tone synthesis
    bytes.ts                frame → wire bytes with checksums
  config/profile.ts         ← your details
```

## Simulation notes

Deliberate simplifications, so nobody mistakes this for a packet-accurate emulator: ACLs are stateless (return traffic must be permitted, as the DMZ preset demonstrates); TCP has no retransmission or teardown, so a lost segment fails the flow; every link has the same latency; there is no VLAN, STP or dynamic routing. A switching loop is caught by a hop limit rather than left to storm.

## Tech

React 19 · TypeScript · Tailwind CSS 4 · Vite · lucide-react · Vitest. Fonts (Inter, JetBrains Mono) are bundled, so the site makes no third-party requests.
