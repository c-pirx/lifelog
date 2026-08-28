# Guide — setup and everyday use

*[Wersja polska →](INSTRUKCJA.md)* · *[Back to README](README.md)*

> **Language note.** The code, database schema and user interface are in
> Polish. The examples below show what you would actually type — feel free to
> use English instead, Claude handles both, but the app's own labels stay
> Polish.

---

# Part 1. Which setup to pick

There are three ways to run this. They differ in **where** you can dictate and
**what it costs**.

| Option | Works in | Requires | Cost |
|---|---|---|---|
| **A. Computer only** | Claude Code, Claude Desktop | a Claude subscription | free |
| **B. Computer + phone** | plus the Claude mobile app | a server and your own domain | VPS + domain |
| **C. Web app only** | a browser | nothing else | free |

**Start with option A.** It takes fifteen minutes, costs nothing, and lets you
find out whether logging things this way suits you before paying for a server.
Moving to option B later requires no rework.

## Why the phone needs a server

This is the most common misunderstanding, so let's clear it up first.

With **Claude Code or Claude Desktop**, the program runs on your computer and
reaches the database directly — nothing has to be on the internet.

With the **Claude mobile app** it is different: Claude connects to your server
**from Anthropic's cloud**, not from your phone. The server therefore needs a
public HTTPS address. That is why option B requires a VPS and a domain, and
there is no way around it.

---

# Part 2. Option A — on your own machine

You need **Node.js 20.12 or newer**, **git**, and a **Claude subscription**
(Pro or Max). Check with `node -v` — on an older 20.x the app stops with a
message telling you to upgrade.

## Step 1. Clone and configure

```bash
git clone https://github.com/c-pirx/lifelog
cd lifelog
npm install
npm run setup
```

`npm run setup` creates `.env` with freshly generated secrets and prints the
password for the web app. **Save it** — you will need it the first time you
open the page.

## Step 2. Build and connect to Claude

```bash
npm run build
```

Then, depending on what you use:

### Claude Code

```bash
claude mcp add --scope user asystent-diety -- node <full-path>/dist/mcp/stdio.js
```

Check with `claude mcp list` — it should report `✓ Connected`.

### Claude Desktop

```bash
npm run rozszerzenie
```

This produces `asystent.mcpb`. In Claude Desktop go to
**Settings → Extensions → Advanced settings → Extension Developer →
Install Extension…** and pick that file.

> **Tools only appear in a new conversation.** MCP servers load at session
> start, so open a fresh chat.

## Step 3. Verify

Ask Claude:

> pokaż podsumowanie dnia
> *(show today's summary)*

If it replies that no targets are set and there are no meals, it works. Go to
part 4.

## The web app (optional)

```bash
npm run dev
```

Open http://localhost:3000 and log in with the password from step 1. The
server only needs to run when you use the web app — Claude does not need it.

---

# Part 3. Option B — access from your phone

Two things become unavoidable:

- **A VPS.** The smallest tier is plenty — this is one Node process and a
  SQLite file. Tested on an OVH VPS-1 (2 cores, 4 GB, 40 GB), which is already
  overkill.
- **A domain or subdomain you control.** Adding one record to a domain you
  already own is enough.

## Step 1. Server and DNS

Order a VPS with **Ubuntu 24.04 or newer** and note its IPv4 address.

In your domain's control panel add:

```
asystent    A    <your-server-ip>
```

> **Add only the A record for now, no AAAA.** Let's Encrypt tries IPv6 first,
> and if your firewall does not allow traffic there the certificate will not be
> issued — with an error message that does not say why. This is the single most
> common cause of a failed deployment.

## Step 2. SSH key access

On your machine:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/asystent_vps -N ""
cat ~/.ssh/asystent_vps.pub
```

Install that public key on the server — easiest when ordering or reinstalling
the VPS, where there is a field for it. If you already have password access,
log in and run **on the server**:

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "<paste-your-public-key-here>" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

Add a shortcut to `~/.ssh/config` on your machine:

```
Host asystent
    HostName <your-server-ip>
    User ubuntu
    IdentityFile ~/.ssh/asystent_vps
    IdentitiesOnly yes
```

From now on `ssh asystent` is enough.

## Step 3. Deploy

Four scripts, in order:

```bash
# 1. Harden the server: firewall, key-only SSH, fail2ban, security updates
bash wdrozenie/wyslij.sh asystent
ssh asystent 'bash /opt/asystent/wdrozenie/01-zabezpiecz.sh'

# 2. Node, the app, a systemd unit, freshly generated production secrets
ssh asystent 'bash /opt/asystent/wdrozenie/02-aplikacja.sh'

# 3. nginx and a Let's Encrypt certificate
ssh asystent 'bash /opt/asystent/wdrozenie/03-https.sh asystent.yourdomain.com'

# 4. Daily database backups
ssh asystent 'bash /opt/asystent/wdrozenie/04-kopie.sh'
```

> **Script 01 disables password login.** Make sure `ssh asystent` works first.
> Your provider's KVM console remains as a fallback.

## Step 4. Create an account and connect the connector

Read the registration gate password:

```bash
ssh asystent 'sudo grep "^REJESTRACJA_HASLO=" /etc/asystent/env'
```

Open `https://asystent.yourdomain.com`, pick **Załóż konto** (create account)
and enter that password as the access code. To invite a friend, send them
`https://asystent.yourdomain.com/?kod=<gate-password>` — the code fills in
by itself.

The connector URL comes **from the app, not from the server**: drawer →
**Konto** → **Wygeneruj i pokaż adres konektora** (every account has its
own; `npm run przenies` also prints it when migrating an old database).

On **claude.ai in a browser** (once, from a computer):
**Customize → Connectors → + → Add custom connector** and paste that URL.
On first tool use pick **Always allow** — otherwise every sentence ends
with a permission prompt.

From then on the tools work in the Claude mobile app too, and the Konto
screen shows "✓ połączono".

## Step 5. Add the app to your phone's home screen

Open `https://asystent.yourdomain.com` in Safari (iPhone) or Chrome (Android),
log in, and choose **Share → Add to Home Screen**. It then behaves like a
normal app, without the browser chrome.

---

# Part 4. Everyday use

## One-time setup

**Targets:**

> ustaw cele: 2600 kcal, 180 g białka, 280 g węgli, 85 g tłuszczu
> *(set targets: 2600 kcal, 180 g protein, 280 g carbs, 85 g fat)*

**Training plan** — just dictate it in plain language and Claude stores it:

> My plan: day A on Mondays — barbell squat 5 sets of 5, bench press 3 sets
> of 8, plank 2 sets of 60 seconds. Day B on Thursdays — deadlift 3 sets of 5,
> barbell row 4 sets of 10.

Check it with:

> pokaż mój plan treningowy
> *(show my training plan)*

## Logging meals

Simply say what you are eating:

> I ate 200 g of chicken breast with rice about fifteen minutes ago

Claude estimates the macros and logs it immediately, telling you the values it
used. When the description is vague it **asks about portion size** instead of
guessing:

> **You:** I had lunch at my mum's
> **Claude:** What was it, roughly how much? Without that any estimate is
> guesswork.

Times work naturally:

> porridge with banana and peanut butter for breakfast at 8:15

and so does backdating:

> yesterday at 20:30 I ate pizza, maybe two thirds of a large one

**Photos work with no extra setup** — take a picture in the Claude app and say
"log this meal".

## Checking your balance

> ile mi zostało dziś białka? *(how much protein do I have left today?)*

> pokaż podsumowanie dnia *(show today's summary)*

> what did I eat yesterday?

## Fixing mistakes

The daily summary shows entry ids, but usually plain language is enough:

> that lunch was closer to 900 kcal, fix it

> delete the last meal

## Training

**At the gym, use the web app.** Between sets, tapping a button beats
composing a sentence. Both entry points work at the same time and see the same
data, so you can mix them freely.

By conversation:

> zaczynam trening A *(starting workout A)*

> squat 5 reps 100 kg

> co mi jeszcze zostało? *(what's left?)*

> kończę trening *(finishing the workout)*

In the app: the **Trening** tab → the plan-day button → **+ Seria** next to
each exercise. The form is pre-filled with your previous result, so usually
you just confirm.

**The system shows what you did last time and flags sets weaker than before —
but it does not tell you how much to add.** That call is yours. If you want an
opinion, ask:

> how has my squat progressed over the last month? should I add weight?

## Body weight

> I weighed myself, 81.4

The reply includes a 7-day rolling average — daily water swings hide the real
trend, so that average is the meaningful number, not any single reading.

## The week: report and pace

A week runs **Sunday through Saturday**, and its report is generated on its own
the following Sunday at 9:00. You never have to ask for it — the server builds
it whether or not you are talking to Claude at the time.

The app shows the week in two places:

- **Progress → "Ten tydzień"** — pace as it happens: what the week will add up
  to at the current rate, whether that lands inside your goal, and whether it is
  going better than at the same point last week. The projection uses **closed**
  days only, because today's intake is still growing.
- **Menu (☰) → Raporty** — the archive of closed weeks with Claude's comment.

In conversation:

> show me this week's report

### A Sunday-morning nudge

To have the report reach your phone by itself, add a scheduled task (routine) in
the Claude app: **Sunday, 9:00**, with a prompt along these lines:

> Read my weekly report (podsumowanie_dnia with okres="tydzien"). Write me a
> short, concrete summary of the week — what went well, what slipped, one thing
> to fix. Then save that same text with a second call to the tool using the
> "komentarz" parameter, so I have it in the app next to the numbers.

A comment saved this way shows up under the numbers in the Raporty tab — six
months later it is the comment, not the table, that tells you what was going on.

---

# Part 5. When something breaks

**`npm install` fails on `better-sqlite3`.**
That is the native SQLite module. npm normally downloads a prebuilt binary; if
there is none for your platform and Node version, it tries to compile and needs
a C++ toolchain — `sudo apt install build-essential python3` on Debian/Ubuntu,
Xcode Command Line Tools on macOS, or the "Desktop development with C++"
workload from the Visual Studio Build Tools on Windows. Upgrading to the
current Node LTS often fixes it outright, because prebuilds exist for it.

**The app says environment variables are missing, but `.env` exists.**
Your Node is older than 20.12 and cannot read `.env` on its own. `node -v`,
then upgrade.

**Claude does not see the tools.**
Open a **new conversation** — MCP servers load at session start. If that does
not help, run `claude mcp list`.

**`claude mcp list` reports `✗ Failed to connect`.**
With the stdio option this almost always means the build is missing — run
`npm run build`. You also need to rebuild after any change to the server code,
because Claude runs what is in `dist/`.

**The connector stopped working on the phone.**
Check the server is alive: `ssh asystent 'systemctl status asystent'`.
If it is, Anthropic may have changed the address ranges its connectors call
from. Rejected requests show up in the log:
`ssh asystent "sudo grep ' 403 ' /var/log/nginx/asystent-dostep.log | tail"`.
Current ranges: https://platform.claude.com/docs/en/api/ip-addresses

**The web app shows an old version.**
Close the tab and reopen it. With the `no-cache` headers in place this should
not happen again.

**I forgot my account password.**
Reset over ssh, no e-mail involved:

```bash
ssh asystent 'cd /opt/asystent && sudo node tools/konta.mjs haslo your-login new-password'
```

The registration gate password (for creating accounts):
`ssh asystent 'sudo grep REJESTRACJA_HASLO /etc/asystent/env'`.

**I want to rotate the connector token.**
In the app: drawer → **Konto** → **Wygeneruj i pokaż adres konektora**.
The old URL stops working immediately; paste the new one on claude.ai.

**I want to start from empty databases.**
Locally: `npm run reset -- --tak`. On the server, stop the service, delete
`/var/lib/asystent/rejestr.db` and the `/var/lib/asystent/uzytkownicy/`
directory and start it again — the schema recreates itself and accounts
are created anew.

---

# Part 6. Limitations worth knowing

**Voice conversation mode does not invoke tools.** Use keyboard microphone
dictation into the text field instead — that works fine.

**Macro estimates are estimates.** Claude will judge calories from a verbal
description about as well as a person looking at the plate. Entries it had to
guess at are marked as estimated, so you can see how much of your data is soft.

**Single user.** There are no accounts and no data separation. Anyone with the
password or the token sees everything.

**A token in the URL is not the authentication method the MCP specification
recommends** — OAuth is. It is used here because claude.ai custom connectors
accept only a URL. The IP allowlist is what makes that defensible. If you were
to store data for more than one person, implement OAuth instead.
