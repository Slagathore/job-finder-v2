# Code signing (Windows)

Job Finder is signed with **Azure Artifact Signing** (formerly Trusted Signing) —
Microsoft's short-lived-certificate signing service. Signed builds remove the
SmartScreen "unknown publisher" warning and let updates verify cleanly.

## One-time setup on a build machine

```powershell
./scripts/setup-signing.ps1     # installs the TrustedSigning module + signtool/dlib/sign CLI + Azure CLI
az login                        # interactive browser sign-in as the Azure account owner
```

Then every release:

```bash
npm run dist:signed             # builds + signs the NSIS installer and portable exe
```

`npm run dist` still produces an **unsigned** build — use it for local testing.

## Signing account

| Field | Value |
|-------|-------|
| Code Signing Account | `Slagathores-Apps` |
| Resource group | `rg-signing` |
| Region / endpoint | Central US · `https://cus.codesigning.azure.net/` |
| Certificate profile | `public` |
| Publisher (cert CN) | `Charles Chambers` |
| SKU | Basic ($9.99/mo, 5,000 signatures) |

These are baked into the `dist:signed` script in `package.json` (`win.azureSignOptions`).
The same account/profile signs all of the author's apps — one identity, shared
SmartScreen reputation.

## Auth

`Invoke-TrustedSigning` authenticates via the Azure Identity default credential
chain, which picks up **`az login`** automatically. For CI, use a service
principal instead and set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`,
`AZURE_CLIENT_SECRET` (the credential chain reads them directly) — the account
needs the **Trusted Signing Certificate Profile Signer** role on the signing
account.

## Local network note (this machine)

The dev box runs Mullvad VPN, whose DNS returns IPv6 (AAAA) records for
`nuget.org` and PSGallery while IPv6 is unroutable through the tunnel — so the
normal `Install-Module` / auto-dependency download **hangs**. `setup-signing.ps1`
works around it by fetching every package with `curl -4` (forced IPv4). The
signing endpoint itself (`cus.codesigning.azure.net`) is IPv4-only, so the actual
sign call works under the VPN with no workaround. If you ever see a signing
download stall, it's this — re-run the setup script; it's idempotent.

## Certificates expire in ~3 days — that's normal

Artifact Signing issues short-lived certs and rotates them automatically. Every
signature is RFC 3161 timestamped, so signed binaries stay valid forever even
after the issuing cert rotates out. You never manage the certs directly.
