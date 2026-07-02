# Security Policy

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please report it responsibly.

### How to Report

**Please do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please report security vulnerabilities by emailing the maintainers directly or using GitHub's private vulnerability reporting feature.

Include the following information:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### What to Expect

- **Acknowledgment**: We will acknowledge receipt within 48 hours
- **Assessment**: We will assess the severity and impact
- **Updates**: We will keep you informed of our progress
- **Resolution**: We aim to resolve critical issues within 7 days
- **Credit**: We will credit you in the release notes (unless you prefer anonymity)

## Security Considerations

### Encryption

Vibe Chat uses end-to-end encryption for messages:

- **Algorithm**: AES-GCM for message encryption
- **Key Exchange**: ECDH P-256 for key agreement
- **Key Storage**: Private keys stored locally in IndexedDB

### Current Limitations

Please be aware of these current security limitations:

1. **Device-Bound Keys**: Encryption keys are stored locally on each device. Logging in from a new device requires re-registration, and previous message history cannot be decrypted.

2. **No Key Rotation**: When a member leaves a channel, channel keys are not currently rotated. This means departed members could theoretically decrypt future messages if they obtained the ciphertext.

3. **No Key Verification (MITM)**: There is no enforced mechanism to verify user identity out-of-band. Identity public keys are fetched from the server and trusted on first use (TOFU); a malicious server could substitute its own keys to intercept channel-key distribution. Key fingerprints are displayed but not enforced.

4. **Backup Key Derived From Account Password**: The client-side encrypted key backup is unlocked with the user's account password, which is also sent to the server for authentication. A compromised server that captures the login password could re-derive the backup key and decrypt the stored private/channel keys. Decoupling the backup passphrase from the login credential is required for a stronger threat model.

5. **No Forward Secrecy**: The current implementation does not provide forward secrecy. Compromise of long-term keys could allow decryption of past messages.

> Items 3 and 4 are known, deferred cryptographic-protocol limitations. Fixing them requires a breaking protocol change plus migration and is tracked separately from the access-control hardening described below.

### Implemented Authentication & Access Control

- Passwords are hashed with **bcrypt (cost 12)** and verified on login (`apps/server/src/lib/auth.ts`).
- **JWT** auth (HS256, algorithm pinned on verification) is required on protected REST endpoints and WebSocket connections.
- **Authorization** is enforced per route: community membership for read/post access; **community-owner-only** for destructive actions (rename/delete channel, update community). Reaction add/remove enforce channel membership and creator-ownership over both REST and WebSocket.
- The key-bundle endpoint (which consumes one-time prekeys) requires authentication to prevent anonymous prekey exhaustion and identity harvesting.
- **Rate limiting**: global 300 req/min per IP, with stricter 10/min limits on credential endpoints (login/register/forgot-password/reset-password).
- **Security headers** via `@fastify/helmet`; a global error handler returns generic 400/500 responses instead of leaking internals.

### Recommended Production Hardening

Before deploying in a production environment with sensitive data:

1. Decouple the key-backup passphrase from the account password (item 4 above)
2. Add key-verification / safety-number enforcement to defeat MITM (item 3 above)
3. Implement key rotation when members leave
4. Enable HTTPS/WSS for all connections
5. Implement audit logging
6. Regular security audits of cryptographic code

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Security Updates

Security updates will be released as patch versions. We recommend always running the latest version.

## Acknowledgments

We appreciate the security research community's efforts in responsibly disclosing vulnerabilities.
