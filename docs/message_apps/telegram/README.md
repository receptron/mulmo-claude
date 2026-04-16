# MulmoClaude — Telegram bridge

Talk to your MulmoClaude from the Telegram app. This guide is for
**operators** — the person running MulmoClaude on their machine and
sharing the bot with friends / family.

日本語版は [`README.ja.md`](README.ja.md) にあります。

---

## What you'll have when you're done

- A Telegram bot (your own — with a name and picture you pick) that
  forwards messages to the MulmoClaude running on your computer.
- A short allowlist of Telegram accounts that can talk to the bot.
  Everyone else gets `"Access denied"`.
- `yarn dev` running in one terminal, `yarn telegram` in another,
  both on your machine.

Your computer has to be on and connected to the internet for the
bot to respond. Close the laptop → the bot goes silent.

---

## Step 1 — Create the bot with BotFather

1. Open Telegram (mobile or desktop).
2. Search for `@BotFather` (the official account has a blue check).
   Start a chat.
3. Send `/newbot`.
4. Answer the two prompts:
   - **Display name**: what shows in chat headers. Anything, e.g.
     `"Alice's MulmoClaude"`.
   - **Username**: must end in `bot`, must be unique on Telegram.
     e.g. `alice_mulmoclaude_bot`.
5. BotFather replies with a **token** — a long string like
   `1234567890:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw`. **This is the
   bot's password. Keep it secret.** Anyone with this token can
   impersonate the bot.

Optional niceties (can be done later):

- `/setdescription` — what users see when opening the chat
- `/setuserpic` — a picture
- `/setprivacy` → `Disable` if you want the bot to respond in
  group chats (not just 1-on-1 DMs)

---

## Step 2 — Run MulmoClaude and start the bridge

In one terminal, start MulmoClaude as usual:

```bash
yarn dev
```

Wait until you see `[server] listening port=3001`.

In a second terminal, run the Telegram bridge with your token. The
allowlist is **empty on purpose** the first time — we'll fill it in
Step 3.

```bash
export TELEGRAM_BOT_TOKEN='1234567890:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw'
export TELEGRAM_ALLOWED_CHAT_IDS=''
yarn telegram
```

You should see:

```
MulmoClaude Telegram bridge
Allowlist: (empty — all chats will be denied)
Connected (<socket id>).
```

---

## Step 3 — Find your own chat ID, add it to the allowlist

1. On Telegram, open your new bot (search the username you
   picked). Send any message — `hi` is fine.
2. On the terminal running `yarn telegram`, you'll see something
   like:
   ```
   [telegram] denied chat=987654321 user=@alice — not on allowlist
   ```
   That number (`987654321`) is **your Telegram chat ID**.
3. Stop the bridge (`Ctrl+C`), set it on the allowlist, restart:

   ```bash
   export TELEGRAM_ALLOWED_CHAT_IDS='987654321'
   yarn telegram
   ```

4. Send the bot another message. This time you should get a reply
   from MulmoClaude.

---

## Step 4 — Invite a friend

When a friend wants to use your MulmoClaude:

1. They find the bot on Telegram (share the username) and send it
   a message.
2. Check your `yarn telegram` terminal — the bridge prints the
   friend's chat ID in the `denied` log line.
3. Add their chat ID to `TELEGRAM_ALLOWED_CHAT_IDS`, restart:

   ```bash
   export TELEGRAM_ALLOWED_CHAT_IDS='987654321,123456789'
   yarn telegram
   ```

4. The friend messages the bot again — it now works.

You can also put the env vars in a `.env` file or a shell profile
so you don't have to re-export on every restart.

---

## Commands the bot understands

Same as the CLI — type these in the Telegram chat:

- `/help` — show help
- `/reset` — start a new conversation session
- `/roles` — list available roles
- `/role <id>` — switch to a role
- `/status` — show the current session info

Anything else is a message to the assistant.

---

## Troubleshooting

**The bridge shows `Connect error: bearer token rejected`.**
The MulmoClaude server was restarted, so the bearer token changed.
Re-run `yarn telegram` to pick up the new one. If you want to
avoid this, pin the token with `MULMOCLAUDE_AUTH_TOKEN` on both
sides (see [`../../developer.md`](../../developer.md) §Auth).

**`TELEGRAM_ALLOWED_CHAT_IDS: "foo" is not an integer chat id`.**
A typo in the allowlist. Chat IDs are integers — no spaces, no
quotes, no `#` prefixes.

**Friend gets `"Access denied"` even though I added their ID.**
Did you restart the bridge after changing the env? The allowlist
is read once at startup.

**Messages stop flowing with no error.**
Check `yarn dev` is still running. If you closed the MulmoClaude
server, the bridge stays up but has nothing to talk to. The next
message will print `Connect error` or `Disconnected`.

**The bot replies from a group chat even though I only added one
user.**
Group chat IDs are **negative** (Telegram convention). If you want
to allow a specific group, add that negative ID. By default
BotFather creates bots with "group privacy mode" on, which means
the bot only sees messages starting with `/` in groups — change
that via BotFather's `/setprivacy` if you want the group use case.

---

## Security notes

- The bot token is like a password. If it leaks, regenerate it via
  BotFather `/revoke`.
- The allowlist is the one defense between "a friend" and "any
  Telegram user on Earth". Keep it current; when a friend stops
  being a friend, remove their chat ID and restart.
- The bridge logs chat IDs, usernames, and message lengths — but
  never message contents or the bot token. If you need a full
  audit trail, keep a separate Telegram-side log (BotFather
  doesn't provide one by default).
- Your MulmoClaude's bearer token never leaves your machine. The
  Telegram bridge connects to `localhost:3001` only; your friends
  talk to Telegram's servers, not yours.
