# Loreloom Self-Signed Code Signing (Personal Multi-PC Setup)

Loreloom uses a self-signed code-signing certificate (`CN=Loreloom Studio`) so your own Windows PCs trust builds signed by GitHub Actions without SmartScreen warnings.

## Trusting Loreloom on Each of Your PCs
Run this once per PC in PowerShell:

```powershell
.\scripts\signing\trust-cert.ps1
```

This installs the public certificate (`LoreloomStudio.cer`) into your Windows user's **Trusted Root Certification Authorities** and **Trusted Publishers** stores.

## How Signing Works in GitHub Actions
- The private key (`LoreloomStudio.pfx`) is **gitignored** and never committed to git.
- Its base64 contents and password are stored securely in your repository's **GitHub Actions Secrets** (`CSC_LINK` and `CSC_KEY_PASSWORD`).
- Every tagged release (`v*`) or manual **Release Windows Installer** workflow run automatically signs the Windows `.exe` installer and portable build.

## Rotating the Certificate
To generate a fresh certificate (e.g., before expiry):

```powershell
.\scripts\signing\generate-cert.ps1
```

Then update `CSC_LINK` and `CSC_KEY_PASSWORD` in GitHub Secrets and re-run `trust-cert.ps1` on your PCs.
