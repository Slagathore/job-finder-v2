# Code signing (Windows)

Job Finder is signed with **Azure Artifact Signing** (formerly Trusted Signing).
Signed builds carry `CN=Charles Chambers` and a Microsoft RFC 3161 timestamp —
SmartScreen warnings fade as the certificate accrues reputation, and signed
binaries stay valid forever even though the underlying certs rotate every ~3
days (that short lifetime is by design; you never manage certs directly).

## Building a signed release

```bash
npm run dist:signed     # build + sign NSIS installer and portable exe
npm run dist            # unsigned build (local testing) — hook skips silently
```

Signing runs through [scripts/azure-sign.js](scripts/azure-sign.js), an
electron-builder custom sign hook (`win.signtoolOptions.sign`) gated behind
`JF_SIGN=1`. The hook shells to `Invoke-TrustedSigning` with every workaround
this machine needs baked in (see "Hard-won lessons" below).

## In-app updates depend on this signature

The updater (electron-updater, wired in `electron/update/installer.ts`) refuses to
install an installer whose Authenticode publisher is not `CN=Charles Chambers`.
That name comes from `build.win.publisherName` in package.json, which
electron-builder writes into `app-update.yml` inside the app. So an unsigned
build cannot update an installed copy in place, by design.

**Every release must include two files or in-app update silently cannot work:**

| File | Why |
|------|-----|
| `JobFinder-<version>-Setup.exe` | the thing that gets installed |
| `latest.yml` | version + sha512 of that exe. The updater reads this first, and verifies the download against the hash in it. |

Both are produced side by side in `dist-installer/` by `npm run dist:signed`.
Upload them from the same build, never mixed across builds, or the hash check
fails and the app refuses the update (correctly).

The v1.0.1 release does **not** carry `latest.yml`, so an installed v1.0.1 will
report that the release is missing its update metadata and point the user at the
releases page. The next release fixes that by shipping the file.

## One-time machine setup

```powershell
./scripts/setup-signing.ps1                                   # toolchain (idempotent)
az login --tenant 44ea2b1d-d069-4396-8402-12cb0cddb50d        # MFA login (plain `az login` fails AADSTS50076)
```

The signing role must exist once per user (already granted to Cole):

```powershell
az role assignment create `
  --assignee-object-id <your user object id: az ad signed-in-user show --query id -o tsv> `
  --assignee-principal-type User `
  --role "Artifact Signing Certificate Profile Signer" `
  --scope "/subscriptions/64c494d3-0992-48ef-8ca8-ef0c2732bb4d/resourceGroups/rg-signing/providers/Microsoft.CodeSigning/codeSigningAccounts/Slagathores-Apps"
```

## Signing account (shared by all of Cole's apps)

| Field | Value |
|-------|-------|
| Code Signing Account | `Slagathores-Apps` |
| Resource group | `rg-signing` |
| Subscription | `Azure subscription 1` (`64c494d3-0992-48ef-8ca8-ef0c2732bb4d`) |
| Tenant | `44ea2b1d-d069-4396-8402-12cb0cddb50d` |
| Region / endpoint | Central US · `https://cus.codesigning.azure.net/` |
| Certificate profile | `public` (Public Trust) |
| Publisher (cert CN) | `Charles Chambers` |
| RBAC role for signing | **Artifact Signing Certificate Profile Signer** (post-rebrand name) |
| SKU / quota | Basic · $9.99/mo · 5,000 signatures/mo pooled across all apps |

## Hard-won lessons (why the hook looks the way it does)

1. **Mullvad VPN blocks all IPv6** (leak protection, refuses with WSAEACCES).
   Modern .NET resolves AAAA first and does not fall back → any .NET HTTP call
   to a dual-stack host dies or hangs. Fix: `DOTNET_SYSTEM_NET_DISABLEIPV6=1`
   in the signing process env (hook sets it).
2. **DefaultAzureCredential's ManagedIdentity probe (169.254.169.254) black-holes
   into the VPN tunnel** and hangs signing for ~20 minutes before any other
   credential is tried. Fix: the hook passes every `-Exclude*Credential`
   switch except Azure CLI, so token acquisition goes straight to `az`.
3. **The dlib finds az via PATH** — a shell older than the az install reports
   "Azure CLI not installed". The hook prepends
   `C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin` unconditionally.
4. **PSGallery/nuget downloads also die on the IPv6 issue** — setup-signing.ps1
   fetches every package with `curl -4` and hand-installs. The TrustedSigning
   module + signtool/dlib/sign-CLI deps live under `%LOCALAPPDATA%\TrustedSigning`.
5. **`az login` without `--tenant` fails** (AADSTS50076: MFA required) — always
   log in tenant-scoped.
6. The signing **endpoint itself is IPv4-only**, so the actual sign call works
   fine under the VPN once the above are handled. Signing takes ~2-3s per file.

## CI (GitHub Actions, future)

Create a service principal, grant it the same role at the same scope, set
`AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` as secrets, and
remove `-ExcludeEnvironmentCredential` from the hook (EnvironmentCredential
reads those vars). GitHub runners have no VPN, so lessons 1–4 don't apply there —
but the hook is harmless on clean networks.
