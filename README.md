# Diet & training assistant

*[Wersja polska →](README.pl.md)*

A self-hosted food and workout journal for **one person**. Two ways in, one
database:

- **Claude** — dictate a sentence on your phone (*"chicken and rice, about 700
  kcal, 2 pm"*) and it gets logged. Works through a custom MCP connector.
- **Web app (PWA)** — for the gym, where holding a conversation is too slow.
  Tap to log a set, with last session's weights already filled in.

Both entry points call the same domain code, so they can never show you
different numbers.

> **Note on language.** The code, comments, database schema and UI are in
> Polish — this started as a personal project. Only the documentation is
> translated. If you fork it, expect to read Polish identifiers.

## Why it exists

Chat assistants forget. Their memory is a lossy summary, not a ledger — fine
for "I'm vegetarian", useless for "what did I eat on the 14th". This gives
Claude an actual database to write to, and gives you an app for the moments
when typing a sentence is slower than tapping a button.

## What it does

**Food** — logs meals with calories and macros, optionally broken down into
components. Daily totals against your targets. Targets carry an effective
date, so changing them doesn't rewrite history. Entries Claude had to guess at
are flagged, so you can see how much of your data is soft.

**Training** — you dictate your plan to Claude once and it stores it. During a
session the system tracks what's done and what's left, shows what you lifted
last time, and flags sets weaker than before. It does **not** prescribe
progression — that call stays yours.

**Body weight** — with a 7-day rolling average, because daily readings swing
too much to read directly.

## Requirements

- Node.js 20+
- Nothing else. The database is a single SQLite file — no database server.

Running it as a Claude connector on your phone additionally needs a public
HTTPS address, which in practice means a small VPS and a domain you control.

## Quick start

```bash
git clone <your-fork>
cd <repo>
npm install
npm run setup      # generates .env with fresh secrets, prints your app password
npm run dev
```

Open http://localhost:3000 and log in with the password `npm run setup`
printed. `npm run demo` fills the database with sample data if you want to see
the screens populated.

## Connecting Claude

There are two MCP entry points into the same database:

| Entry point | File | For |
|---|---|---|
| **stdio** | `dist/mcp/stdio.js` | Claude Code, Claude Desktop |
| **HTTP** | `/mcp/<token>` | the web app, and phone access after deploying |

**Start with stdio.** Claude launches the process when it needs it and shuts
it down afterwards — nothing has to run in the background:

```bash
npm run build
claude mcp add --scope user asystent-diety -- node <path>/dist/mcp/stdio.js
```

`claude mcp list` should report `✓ Connected`. Tools appear in a **new**
session, since MCP servers load at session start.

For **Claude Desktop**, build an extension and install it through
Settings → Extensions → Advanced settings → Install Extension:

```bash
npm run build && npm run rozszerzenie
```

For **claude.ai and the mobile app**, you need the HTTP entry point on a
public HTTPS address — see [deployment](#deployment). Claude connects from
Anthropic's cloud, not from your phone, so `localhost` will not work there.

## Deployment

`wdrozenie/` holds scripts that take a fresh Ubuntu/Debian VPS to a running
HTTPS service: firewall, SSH hardening, unattended security updates, the app
as a locked-down systemd unit, nginx with a Let's Encrypt certificate, and
daily database backups.

```bash
ssh you@your-server 'bash /opt/asystent/wdrozenie/01-zabezpiecz.sh'
bash wdrozenie/wyslij.sh your-server
ssh you@your-server 'bash /opt/asystent/wdrozenie/02-aplikacja.sh'
ssh you@your-server 'bash /opt/asystent/wdrozenie/03-https.sh your.domain'
ssh you@your-server 'bash /opt/asystent/wdrozenie/04-kopie.sh'
```

Full walkthrough, including how to restore a backup: [wdrozenie/README.md](wdrozenie/README.md).

## Security

This holds health data, so the defaults lean strict:

- The MCP endpoint requires a 256-bit token **and** only answers requests from
  [Anthropic's published address ranges](https://platform.claude.com/docs/en/api/ip-addresses).
  A leaked token is useless from anywhere else.
- The token is part of the URL, so nginx is configured to mask it in access
  logs. Without that, the secret would sit in plain text in log files and
  their archives.
- Rate limits on the connector and on login make password guessing pointless.
- Password login over SSH is disabled; the app runs as a system account with
  no shell and no write access outside its own data directory.

**Understand the trade-off before you rely on this.** Putting a token in the
URL is not the authentication method the MCP specification recommends — OAuth
is. It is used here because claude.ai custom connectors accept only a URL, and
running an OAuth authorization server for a single user is disproportionate.
The address allowlist is what makes it defensible. If you are storing data for
more than yourself, implement OAuth instead.

## Architecture

```
migrations/     database schema, applied automatically at startup
src/
  server.ts     entry point — mounts /mcp, /api and static files
  db/repo.ts    the only file containing SQL
  domain/       all business logic
  mcp/          MCP tools — a thin adapter over domain/
  api/          REST for the web app — the same kind of adapter
  lib/time.ts   time zones and day boundaries
public/         the PWA
wdrozenie/      server provisioning scripts
```

Two rules hold this together:

1. **Logic lives in `domain/`.** `mcp/` and `api/` only call it. A feature
   added on one side only is a bug — chat and app would drift apart.
2. **All SQL lives in `db/repo.ts`.** That boundary is what would make
   swapping SQLite for Postgres a single-file rewrite.

A third, nearly as important: **all time conversion goes through
`lib/time.ts`**. The user's day is measured in their local zone while the
server runs in UTC. Rows store a precomputed `data_lokalna` (`YYYY-MM-DD`), so
asking about a day is a string comparison rather than time-zone arithmetic in
SQL.

## Tests

```bash
npm test         # 134 tests
npm run typecheck
```

Coverage focuses on the parts where a bug is expensive and silent: day
boundaries across daylight-saving changes, targets changing mid-history,
workout session state, and corrections applied from either entry point. The
MCP and REST layers are covered by integration tests that start a real server
and talk to it over HTTP.

## License

MIT — see [LICENSE](LICENSE).
