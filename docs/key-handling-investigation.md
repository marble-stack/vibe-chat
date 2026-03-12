# Investigation: Key Handling Compared to Discord & WhatsApp — Root Causes of Decryption Instability

## Context

Vibe Chat uses a simplified E2E encryption model inspired by the Signal Protocol (Sender Keys), but its device-switching experience is unstable — users frequently see "[Syncing keys...]" placeholders that never resolve. This investigation compares Vibe Chat's approach to WhatsApp and Discord to identify architectural gaps causing the instability.

---

## How WhatsApp, Discord, and Signal Handle Keys

### WhatsApp (Signal Protocol + Multi-Device)
- **Per-device identity keys**: Each device (phone, web, desktop) has its own independent identity key pair, cryptographically bound to the account via mutual signatures.
- **Client-fanout**: Every message is encrypted N times — once per recipient device — using pairwise Double Ratchet sessions. No shared symmetric key.
- **Device linking**: New devices are added by scanning a QR code from the primary device, which signs the new device's identity key. Both devices sign each other.
- **Message history transfer**: Primary device sends encrypted recent history directly to the new companion device over an encrypted channel.
- **Encrypted cloud backups** (optional): AES-256 key stored in HSM-backed Backup Key Vault (password-protected with rate-limiting) or user-held 64-digit key. Backups contain message history, not key material.
- **Key rotation**: Sender Keys in groups rotate when a member leaves. Double Ratchet in 1:1 chats provides per-message forward secrecy.

### Discord (DAVE Protocol — Voice/Video Only)
- **No E2E encryption for text messages** at all. Server reads all text.
- **MLS-based group key exchange** for voice/video only — ephemeral keys per call session.
- **No device-switching key problem** because there's no persistent E2E key material.
- Not a meaningful comparison for text-based E2E encryption.

### Signal (Sesame + Sender Keys)
- Same per-device identity key model as WhatsApp (WhatsApp adopted Signal's design).
- **Sesame algorithm** manages sessions across multiple devices per user.
- **Secure Backups** (2025): Optional encrypted backup using 64-character recovery key, stored in SVR3 (Secure Value Recovery) with rate-limited PIN attempts.
- **Message transfer**: Up to 45 days of history can sync to newly linked devices.

---

## Vibe Chat's Current Architecture vs. WhatsApp/Signal

### Fundamental Architectural Differences

| Aspect | WhatsApp/Signal | Vibe Chat |
|--------|----------------|-----------|
| **Identity keys** | Per-device, independently generated | Single identity, backed up to server |
| **Group encryption** | Sender Keys (per-sender chain) | Single shared AES-256-GCM symmetric key per channel |
| **Key distribution** | Pairwise Double Ratchet sessions | Encrypt channel key to each member's public key |
| **Device switching** | New device gets own keys + device linking ceremony | Restore same keys from password-encrypted backup |
| **Key backup contents** | Message history (not keys) | Identity keys + channel keys |
| **Forward secrecy** | Yes (Double Ratchet / chain ratchet) | None |
| **Key rotation** | On member leave | Not implemented |

---

## Root Causes of Decryption Instability

### 1. Single-Identity-Key Model Creates a Fragile Backup Dependency

**The problem**: Vibe Chat has ONE identity key pair per user (not per-device). When switching devices, the user MUST restore the exact same private key from the server backup — otherwise all existing encrypted channel keys (which were encrypted to that public key) become undecryptable.

**WhatsApp's approach**: Each device generates its own keys. The new device doesn't need the old device's private key — it establishes fresh pairwise sessions and receives keys encrypted to its own new public key.

**Impact on Vibe Chat**: Any failure in the backup/restore chain (wrong password, corrupt backup, missing backup, race condition) means total loss of decryption ability. There is no fallback.

**Files**: `apps/web/src/pages/Login.tsx` (restore flow), `apps/web/src/lib/crypto.ts` (`decryptKeyBackup`)

### 2. Channel Key Backup is Bolted On, Not Integral

**The problem**: Channel keys were added to the backup as an optional field (`channelKeys?`) in commit `5d1ab6c`. This creates a chicken-and-egg issue:
- Old backups on the server don't contain channel keys
- The re-upload mechanism in `Chat.tsx` only fires if `sessionPassword` is available AND `getAllChannelKeys()` returns non-empty
- `sessionPassword` is stored in-memory in the auth store during login, but the `Chat.tsx` effect that consumes it may run before it's set (race condition)

**WhatsApp's approach**: Backups contain message history, not keys. Keys are per-device and freshly generated. There's no need to "bolt on" key material to an existing backup format.

**Files**: `apps/web/src/pages/Chat.tsx` (lines 194-246), `apps/web/src/stores/auth.ts` (`sessionPassword`)

### 3. No Device Linking Ceremony — Backup is the Only Path

**The problem**: Vibe Chat has no mechanism for a new device to announce itself and have existing key holders re-encrypt channel keys for the new device's identity. The ONLY path is restoring the same identity from backup. If backup fails, the user must "Start Fresh" (new identity), which means:
- All previously encrypted channel keys are useless
- The `key:request` WebSocket mechanism kicks in, but it depends on the original key creator being online
- If the original key creator is also on a new device (same problem), deadlock

**WhatsApp's approach**: Device linking via QR code + mutual signing. New device gets its own identity and other devices are notified to establish sessions with it.

**Files**: `apps/web/src/lib/channelCrypto.ts` (lines 67-275, `ensureChannelKey`)

### 4. Key Redistribution Depends on Online Presence

**The problem**: When a user needs a channel key (new device or new member), the flow is:
1. Client sends `key:request` via WebSocket
2. Server forwards `key:requested` to online key holders
3. Key holder re-encrypts and distributes via REST
4. Server sends `key:available` back

If no key holder is online, the request goes to `pendingKeyRequests` table — but it only gets processed when a key holder logs in and their client checks `/pending-key-requests`. The polling fallback in `Chat.tsx` retries every 2-15 seconds, but this only helps if someone comes online.

**WhatsApp's approach**: Prekeys are uploaded to the server. A new device can establish a session with any contact using their prekeys without the contact being online. No online-presence dependency.

**Files**: `apps/server/src/websocket/index.ts` (lines 571-642), `apps/web/src/pages/Chat.tsx` (polling, lines 803-917)

### 5. Solo-User / Self-Deadlock Scenario

**The problem**: If a user is the only member of a channel and logs in on a new device:
- Their channel key on the server is encrypted to their OLD identity key
- New device has the same identity (from backup) — this should work IF backup restore succeeded
- But if they "Started Fresh" (new identity), the encrypted key is undecryptable
- `key:request` targets key holders — which is themselves — creating a self-request deadlock
- After 30 seconds (`REDISTRIBUTION_TIMEOUT_MS`), the deadlock breaker creates a NEW key, but this means all old messages are permanently unreadable

**WhatsApp's approach**: This scenario doesn't exist because backups contain message history (not keys), and each device has independent identity keys.

**Files**: `apps/web/src/lib/channelCrypto.ts` (lines 38-42, deadlock breaker)

### 6. No Forward Secrecy Amplifies Key Loss

**The problem**: Vibe Chat uses a single static AES-256-GCM key per channel with no ratcheting. If this key is lost (failed backup, corrupted IndexedDB), ALL past AND future messages in that channel are lost until a new key is created.

**WhatsApp/Signal's approach**: Sender Keys use a chain ratchet — each message derives a new key from the previous one. Losing the current key doesn't retroactively affect already-decrypted messages, and forward secrecy limits damage from key compromise.

---

## Summary: Why Device Switching Fails

The decryption instability is caused by a cascading chain of dependencies:

```
Login on new device
  → Must restore exact same identity key from backup
    → Backup must exist on server
    → Backup must include channel keys (only if re-uploaded after fix)
    → Password must be correct
    → sessionPassword must be set before Chat.tsx effect runs (race condition)
  → If any step fails → "Start Fresh" → new identity → old keys undecryptable
    → key:request sent → depends on key holder being online
    → If solo user → self-deadlock → 30s timeout → new key → old messages lost
```

WhatsApp avoids this entire chain by using **per-device identity keys** + **device linking** + **prekey-based session establishment**. There is no single point of failure.

---

## Recommended Improvements (Ordered by Impact)

### Short-term fixes (address the immediate bugs):
1. **Fix the `sessionPassword` race condition**: Ensure `sessionPassword` is set in the auth store BEFORE navigating to Chat.tsx, not concurrently. Use a synchronous check or await pattern.
2. **Make channel keys a required field in backups**: Always include channel keys when uploading backups (not optional). Re-upload backup on every channel key change, not just during the prefetch effect.
3. **Fix the solo-user deadlock**: Detect when the only key holder is the current user and skip WebSocket redistribution — directly attempt decryption with the restored identity key instead.

### Medium-term architectural improvements:
4. **Server-side key escrow for channel keys**: Store channel keys encrypted to a user-derived key (separate from the identity backup). This removes the dependency on the backup containing channel keys and on other users being online.
5. **Decouple backup from device identity**: Allow "re-keying" — when a user restores from backup, automatically re-encrypt all channel keys for the restored identity and re-upload. This makes backup restore idempotent.

### Long-term (toward WhatsApp/Signal model):
6. **Per-device identity keys with device linking**: Each device gets its own identity key pair. Linking is done by the existing device signing the new device's key. Channel keys are re-distributed to the new device's public key.
7. **Sender Key chain ratcheting**: Add forward ratcheting to channel keys so key loss only affects future messages, not the entire history.

---

## Verification

To confirm the analysis:
1. Open browser DevTools Network tab, log in on a new device (incognito)
2. Check for `PUT /auth/key-backup` — verify it fires and includes `channelKeys`
3. Check `sessionPassword` in React DevTools (auth store) — verify timing
4. Test solo-user scenario: create a channel, send messages, log in on new device
5. Test offline key holder: have User A go offline, User B join and try to read messages
6. Check WebSocket messages for `key:request` / `key:requested` / `key:available` flow

## Key Files

- `apps/web/src/lib/channelCrypto.ts` — channel key lifecycle
- `apps/web/src/lib/crypto.ts` — backup encrypt/decrypt
- `apps/web/src/lib/keyStore.ts` — IndexedDB storage
- `apps/web/src/pages/Login.tsx` — backup restore flow
- `apps/web/src/pages/Chat.tsx` — prefetch + backup re-upload
- `apps/web/src/stores/auth.ts` — sessionPassword state
- `apps/server/src/websocket/index.ts` — key:request handler
- `apps/server/src/routes/channels.ts` — sender key REST endpoints
- `apps/server/src/routes/auth.ts` — key backup endpoints
