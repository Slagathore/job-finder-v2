# Security

## Reporting a vulnerability

Open a [GitHub issue](https://github.com/Slagathore/job-finder-v2/issues) for anything low
stakes. For something you don't want public before it's fixed, use this repo's private
vulnerability reporting (Security tab, "Report a vulnerability") or email
charcham7@gmail.com. This is a solo personal project, so response time depends on when I see
it, but I do read both.

## What this app is

A single user desktop app. Electron main process plus a React UI, a local SQLite database,
and a companion browser extension. There is no account system and no server I operate. Your
resume, job data, application history, backups, and exports live in your own user data
folder, nowhere else, unless one of the network calls below is involved.

## What runs where, and what leaves the machine

- **The app itself.** 100% local. No backend service, no login, no phone home beyond the
  items below.
- **Local hub (`electron/server/http.ts`).** An HTTP server bound to `127.0.0.1` only, not
  `0.0.0.0`, default port 17893 (configurable in Settings). This is how the browser extension
  delivers harvested job listings and captured form fields to the app. Every route except
  `/ping` requires the `X-JF-Token` pairing token in a header; `/ping` is unauthenticated on
  purpose so the extension can detect the app before pairing, but it now rejects requests that
  carry a browser page `Origin` header, so an ordinary webpage's own script can't use it to
  fingerprint whether the app is running.
- **Browser extension.** Manifest V3, permissions limited to `storage` plus the job board
  domains it reads and `127.0.0.1`/`localhost`. It only ever talks to the local hub above, see
  [`extension/PRIVACY.md`](extension/PRIVACY.md) for the extension's own policy.
- **AI backend.** Ollama's native API at `http://127.0.0.1:11434` by default. The shipped
  Primary model is `kimi-k2.7-code:cloud`, a hosted model reached through your local Ollama
  daemon, so a fresh install does send the text used for matching, resume digesting, and
  tailoring to Ollama's cloud by default. To keep that fully local, pull a local model
  (`ollama pull llama3.2`, for example) and set it as the Primary model in Settings. Embeddings
  (`nomic-embed-text`) are always local, there is no cloud embedding path in the code.
  Adding an Anthropic API key is an explicit, separate cloud call.
- **Gmail (optional, off unless you connect it).** OAuth with your own client credentials,
  `gmail.readonly` scope only. The app reads and locally classifies application related
  threads into your pipeline; it never writes anything back to your mailbox.
- **Job data lookups.** Direct calls to Greenhouse/Ashby/Lever's public APIs, company career
  pages during board autodiscovery, BLS OEWS for salary medians, and Glassdoor for company
  scores. These are outbound, read only fetches to public endpoints, the same thing a browser
  would do, and don't need an account.
- **Contact discovery and autofill.** Recruiter lookup runs a Google search in a hidden,
  sandboxed browser window (`electron/career/contacts.ts`); apply autofill opens the real job
  posting in another sandboxed window (`electron/apply/autofill.ts`). Both load third party
  pages, so both run with Electron's `sandbox: true`.
- **Update check.** On load, the app checks this repo's public GitHub releases API and a
  static `UPDATE.json` file for a newer version. No user data is included, it's a version
  comparison.

## Secrets

Anthropic API key and Gmail OAuth credentials are encrypted at rest using your OS keychain
(Electron's `safeStorage`, see `electron/ipc/settings.ts`). If no keychain backend is
available, for example a Linux box without `gnome-keyring`/`libsecret`, the app refuses to
store the secret in cleartext rather than writing it unencrypted to disk.

The extension pairing token and hub port are plain values in the local settings table, not
keychain encrypted. That token only lets something on your own machine talk to your own hub,
it isn't a credential to any outside account, and you can rotate it from Settings any time.

## Local and LAN threat model

This app trusts your OS user account. Anything that can run code as you, or that has your
unlocked session, can read the SQLite database and any secrets decrypted while the app is
running. That's the same trust boundary as any other desktop app that isn't sandboxed from its
own user.

The local hub binds to `127.0.0.1` only, so nothing on your LAN or the internet can reach it,
only processes on the same machine. A malicious webpage open in a normal browser tab can't
read anything from the hub (no CORS headers are returned) and can't call any token gated route
without the token; the most it could do before this hardening pass was confirm the hub exists
by hitting `/ping`, which is now blocked for page level requests too. This isn't designed to
resist another local account or process on a machine you don't fully control, on a personal,
single user computer that's the accepted model.

## Self-extension (the agent edits its own code)

The Self-extend tab lets the built in agent write and apply patches to the app's own source,
from an instruction you type. By design there is no protected file list, the agent can edit
anything including its own safety code, because the real safeguard is that a human has to
approve every patch, not a list of off limits files.

Flow: your instruction goes to the LLM, which proposes a patch. An advisory static scan flags
risky constructs (`eval`, `child_process`, deleting files, and so on) and, as of this pass,
flags any patch that touches the self-extension pipeline's own files
(`electron/selfext/**`, `electron/ipc/selfext.ts`) as high severity purely by file path, with
its own extra confirmation dialog before you can apply it. The patch then runs in an isolated
temp directory clone, lint and the full test suite have to pass there, the live app is never
touched by an unreviewed patch. Applying still requires an explicit click, which the app
enforces server side too (not just a disabled button), and every applied patch is backed up so
it can be rolled back.

Known gap, not fixed here: the sandbox runs the patched clone's own `package.json` `test` and
`lint` scripts to grade itself. Only `node_modules` is protected (reused via a directory
junction); a sufficiently deliberate patch could still rewrite what those scripts do before
they run. Realistic risk is low today, since a proposal only ever starts from text you type
yourself, nothing scraped or emailed feeds this pipeline, but the sandbox's pass/fail signal
isn't fully independent of the patch it's grading.

## Known limitations

- The macOS build is unsigned. Gatekeeper says "damaged" on first open, right click then Open
  gets past it (see the README). No Apple notarization yet.
- The main window and the offscreen PDF renderer run with `sandbox: false` (both still use
  `contextIsolation: true` and `nodeIntegration: false`, and neither loads third party pages,
  the main window only loads the app's own bundled UI and the PDF window only a locally
  generated file). The two windows that load live third party pages, contact discovery and
  apply autofill, run with `sandbox: true`.
- Bulk apply is gated by a blocklist and listing liveness checks and is off by default. Review
  it before turning it on.
- No professional security audit has been done on this app. It's a personal project I use
  myself and also ship publicly. The above is an honest description of how it behaves, not a
  guarantee.
