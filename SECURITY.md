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

3. **No Key Verification**: There is no mechanism to verify user identity or detect man-in-the-middle attacks on key exchange.

4. **Simplified Authentication**: The current authentication system is simplified and does not include password verification. This should be enhanced before production use with sensitive data.

5. **No Forward Secrecy**: The current implementation does not provide forward secrecy. Compromise of long-term keys could allow decryption of past messages.

### Recommended Production Hardening

Before deploying in a production environment with sensitive data:

1. Implement proper authentication with secure password hashing (bcrypt/argon2)
2. Add authorization checks for channel/community access
3. Implement key rotation when members leave
4. Add rate limiting to prevent abuse
5. Enable HTTPS/WSS for all connections
6. Implement audit logging
7. Regular security audits of cryptographic code

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Security Updates

Security updates will be released as patch versions. We recommend always running the latest version.

## Acknowledgments

We appreciate the security research community's efforts in responsibly disclosing vulnerabilities.
