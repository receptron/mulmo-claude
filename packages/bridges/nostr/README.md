# @mulmobridge/nostr

> **Experimental** — please test and [report issues](https://github.com/receptron/mulmoclaude/issues/new).

[Nostr](https://nostr.com/) encrypted-DM bridge for [MulmoClaude](https://github.com/receptron/mulmoclaude). Connects to any list of Nostr relays over WebSocket, handles [NIP-04](https://github.com/nostr-protocol/nips/blob/master/04.md) encrypted direct messages, and replies as a signed `kind=4` event. Outbound-only — **no public URL needed**.

## Setup

### 1. Generate a bot key

A brand-new Nostr identity is just a secret key. One-liner:

```bash
node -e "const { generateSecretKey, getPublicKey, nip19 } = require('nostr-tools'); const sk = generateSecretKey(); console.log('NOSTR_PRIVATE_KEY=' + Buffer.from(sk).toString('hex')); console.log('npub: ' + nip19.npubEncode(getPublicKey(sk)));"
```

Or use any Nostr client (Damus / Amethyst / Iris / Primal) to register and export the secret key (`nsec1…`).

### 2. Pick relays

Public, free relays that accept everyone:

- `wss://relay.damus.io`
- `wss://nos.lol`
- `wss://relay.snort.social`
- `wss://nostr.wine`
- `wss://relay.nostr.band`

Start with 2–3. More relays = better reach but more network traffic.

### 3. Run the bridge

```bash
NOSTR_PRIVATE_KEY=your-hex-or-nsec \
NOSTR_RELAYS=wss://relay.damus.io,wss://nos.lol \
npx @mulmobridge/nostr
```

Send a Nostr DM to the bot's `npub` from any Nostr client — you'll get a reply.

## Environment variables

| Variable                 | Required | Default | Description |
|--------------------------|----------|---------|-------------|
| `NOSTR_PRIVATE_KEY`      | yes      | —       | 64-char hex or `nsec1…` bech32 bot secret key |
| `NOSTR_RELAYS`           | yes      | —       | CSV of `wss://` relay URLs |
| `NOSTR_ALLOWED_PUBKEYS`  | no       | (all)   | CSV of hex pubkeys allowed to DM the bot (lower-case). Empty = everyone |
| `MULMOCLAUDE_AUTH_TOKEN` | no       | auto    | MulmoClaude bearer token override |
| `MULMOCLAUDE_API_URL`    | no       | `http://localhost:3001` | MulmoClaude server URL |

## How it works

1. Bridge derives the bot's pubkey from the secret key and opens WebSocket subscriptions to every relay in `NOSTR_RELAYS`.
2. Filter: `kinds=[4]` + `#p=<botPubkey>` + `since=now-60s` (avoids re-processing historical events on restart).
3. For each inbound event, we verify (`nostr-tools` does it), decrypt with NIP-04 ECDH + AES-CBC, check the sender against the allowlist, and forward the plaintext to MulmoClaude keyed by `sender pubkey (hex)`.
4. Replies are encrypted back with the sender's pubkey, signed as a fresh `kind=4` event, and broadcast to all relays. Any relay accepting it = successful delivery (clients will see the message).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| No events delivered | Your relays don't replicate inbound kind=4 events | Add a high-availability relay like `wss://relay.damus.io` |
| Decrypt failed | Sender used NIP-44 (newer spec) or non-standard encryption | NIP-44 support is deferred to v0.2 — for now tell the user to send via a NIP-04-compatible client |
| Reply never shows up in the sender's client | All your relays rejected the event (spam filter / rate-limit) | Add more relays; most clients read from many in parallel |

## Security notes

- The secret key is the bot's entire identity. Store it in a secret manager (not plain env / shell history).
- Nostr relays see the **ciphertext** of every DM — the plaintext is only readable by the sender and recipient. Metadata (who talks to whom, when, how much) is public.
- NIP-04 is the legacy standard. NIP-44 is newer with better cryptography but isn't universally deployed yet. This bridge does NIP-04 only in v0.1.0.
- Without `NOSTR_ALLOWED_PUBKEYS`, any Nostr user who DMs the bot pubkey can converse with your MulmoClaude. Use allowlisting for personal agents.
- The bot will also see its own echoes if relays replay events — we filter on `evt.pubkey === ourPubkey` so they're ignored.
