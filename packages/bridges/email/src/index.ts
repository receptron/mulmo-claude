#!/usr/bin/env node
// @mulmobridge/email — Email bridge for MulmoClaude.
//
// Polls an IMAP INBOX for UNSEEN messages, forwards each to MulmoClaude,
// and replies via SMTP preserving Message-ID threading (In-Reply-To +
// References so the reply lands in the same mail thread in the sender's
// client). Outbound-only — no public URL required.
//
// Required env vars:
//   EMAIL_IMAP_HOST, EMAIL_IMAP_USER, EMAIL_IMAP_PASSWORD
//   EMAIL_SMTP_HOST, EMAIL_SMTP_USER, EMAIL_SMTP_PASSWORD
//   EMAIL_FROM — bot's email address (usually equal to EMAIL_SMTP_USER)
//
// Optional:
//   EMAIL_IMAP_PORT (993) / EMAIL_IMAP_TLS (true)
//   EMAIL_SMTP_PORT (587) / EMAIL_SMTP_TLS (auto — STARTTLS at 587, TLS at 465)
//   EMAIL_ALLOWED_SENDERS  — CSV of sender addresses allowed (empty = all)
//   EMAIL_POLL_INTERVAL_SEC — poll interval (default 30)

import "dotenv/config";
import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import nodemailer from "nodemailer";
import { createBridgeClient, chunkText } from "@mulmobridge/client";

const TRANSPORT_ID = "email";
const MAX_REPLY_LEN = 100_000;
const DEFAULT_POLL_SEC = 30;

const imapHost = process.env.EMAIL_IMAP_HOST;
const imapUser = process.env.EMAIL_IMAP_USER;
const imapPass = process.env.EMAIL_IMAP_PASSWORD;
const smtpHost = process.env.EMAIL_SMTP_HOST;
const smtpUser = process.env.EMAIL_SMTP_USER;
const smtpPass = process.env.EMAIL_SMTP_PASSWORD;
const fromAddress = process.env.EMAIL_FROM;

if (!imapHost || !imapUser || !imapPass || !smtpHost || !smtpUser || !smtpPass || !fromAddress) {
  console.error(
    "Required: EMAIL_IMAP_HOST, EMAIL_IMAP_USER, EMAIL_IMAP_PASSWORD, EMAIL_SMTP_HOST, EMAIL_SMTP_USER, EMAIL_SMTP_PASSWORD, EMAIL_FROM.\n" +
      "See README for setup instructions.",
  );
  process.exit(1);
}

const imapPort = Number(process.env.EMAIL_IMAP_PORT) || 993;
const imapTls = (process.env.EMAIL_IMAP_TLS ?? "true").toLowerCase() !== "false";
const smtpPort = Number(process.env.EMAIL_SMTP_PORT) || 587;
const smtpSecure = process.env.EMAIL_SMTP_TLS ? process.env.EMAIL_SMTP_TLS.toLowerCase() === "true" : smtpPort === 465;
const pollIntervalSec = Math.max(10, Number(process.env.EMAIL_POLL_INTERVAL_SEC) || DEFAULT_POLL_SEC);
const allowedSenders = new Set(
  (process.env.EMAIL_ALLOWED_SENDERS ?? "")
    .split(",")
    .map((addr) => addr.trim().toLowerCase())
    .filter(Boolean),
);
const allowAll = allowedSenders.size === 0;

const mulmo = createBridgeClient({ transportId: TRANSPORT_ID });

const smtp = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpSecure,
  auth: { user: smtpUser, pass: smtpPass },
});

mulmo.onPush((pushEvent) => {
  // chatId is the recipient email. Cannot thread without a prior message id.
  sendReply(pushEvent.chatId, "", [], pushEvent.message).catch((err) => console.error(`[email] push send failed: ${err}`));
});

// ── Send ────────────────────────────────────────────────────────

interface ReplyMeta {
  recipient: string;
  subject: string;
  inReplyTo: string;
  references: string[];
}

async function sendReply(recipient: string, subject: string, references: string[], text: string): Promise<void> {
  const subj = subject.startsWith("Re:") ? subject : `Re: ${subject || "(no subject)"}`;
  const truncated = text.length > MAX_REPLY_LEN ? text.slice(0, MAX_REPLY_LEN) + "\n\n…(truncated)" : text;
  const inReplyTo = references[references.length - 1] ?? "";
  try {
    await smtp.sendMail({
      from: fromAddress,
      to: recipient,
      subject: subj,
      text: truncated,
      inReplyTo: inReplyTo || undefined,
      references: references.length > 0 ? references : undefined,
    });
  } catch (err) {
    console.error(`[email] SMTP send failed: ${err}`);
  }
}

// ── Receive ─────────────────────────────────────────────────────

interface Incoming {
  senderAddress: string;
  subject: string;
  text: string;
  messageId: string;
  references: string[];
}

function referenceChain(parsed: ParsedMail): string[] {
  const refs = parsed.references;
  if (Array.isArray(refs)) return refs.filter((entry) => typeof entry === "string");
  if (typeof refs === "string") return [refs];
  return [];
}

function stripHtmlTags(html: string): string {
  // Char-by-char to avoid regex backtracking on malformed HTML.
  const out: string[] = [];
  let inTag = false;
  for (const char of html) {
    if (char === "<") inTag = true;
    else if (char === ">") inTag = false;
    else if (!inTag) out.push(char);
  }
  return out.join("").replace(/\n\s*\n\s*\n+/g, "\n\n");
}

function extractPlainBody(parsed: ParsedMail): string {
  if (parsed.text) return parsed.text.trim();
  if (parsed.html) return stripHtmlTags(parsed.html).trim();
  return "";
}

function parseIncoming(parsed: ParsedMail): Incoming | null {
  const fromObj = parsed.from;
  const senderAddress = fromObj && fromObj.value.length > 0 ? String(fromObj.value[0].address ?? "").toLowerCase() : "";
  const subject = parsed.subject ?? "";
  const text = extractPlainBody(parsed);
  const messageId = parsed.messageId ?? "";
  if (!senderAddress || !text || !messageId) return null;
  const existing = referenceChain(parsed);
  const references = [...existing, messageId];
  return { senderAddress, subject, text, messageId, references };
}

async function handleIncoming(msg: Incoming): Promise<void> {
  if (msg.senderAddress === fromAddress!.toLowerCase()) return;
  if (!allowAll && !allowedSenders.has(msg.senderAddress)) {
    console.log(`[email] denied from=${msg.senderAddress}`);
    return;
  }

  console.log(`[email] message from=${msg.senderAddress} subject="${msg.subject.slice(0, 60)}" len=${msg.text.length}`);

  const meta: ReplyMeta = {
    recipient: msg.senderAddress,
    subject: msg.subject,
    inReplyTo: msg.messageId,
    references: msg.references,
  };

  try {
    const chunks = chunkText(msg.text, MAX_REPLY_LEN);
    const combined = chunks.join("");
    const ack = await mulmo.send(msg.senderAddress, combined);
    const statusSuffix = ack.status ? ` (${ack.status})` : "";
    const replyText = ack.ok ? (ack.reply ?? "") : `Error${statusSuffix}: ${ack.error ?? "unknown"}`;
    await sendReply(meta.recipient, meta.subject, meta.references, replyText);
  } catch (err) {
    console.error(`[email] handleIncoming error: ${err}`);
  }
}

// ── Poll loop ───────────────────────────────────────────────────

async function processUnread(client: ImapFlow): Promise<void> {
  const lock = await client.getMailboxLock("INBOX");
  try {
    const uids = await client.search({ seen: false });
    if (!uids || uids.length === 0) return;
    for (const uid of uids) {
      try {
        const message = await client.fetchOne(String(uid), { source: true });
        if (!message || !message.source) continue;
        const parsed = await simpleParser(message.source);
        const incoming = parseIncoming(parsed);
        if (incoming) await handleIncoming(incoming);
        await client.messageFlagsAdd(String(uid), ["\\Seen"]);
      } catch (err) {
        console.error(`[email] fetch uid=${uid} error: ${err}`);
      }
    }
  } finally {
    lock.release();
  }
}

async function pollLoop(): Promise<void> {
  const client = new ImapFlow({
    host: imapHost!,
    port: imapPort,
    secure: imapTls,
    auth: { user: imapUser!, pass: imapPass! },
    logger: false,
  });

  await client.connect();
  console.log(`[email] IMAP connected ${imapHost}:${imapPort}`);

  while (true) {
    try {
      await processUnread(client);
    } catch (err) {
      console.error(`[email] poll error: ${err}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, pollIntervalSec * 1_000));
  }
}

// ── Main ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("MulmoClaude Email bridge");
  console.log(`IMAP: ${imapUser}@${imapHost}:${imapPort}${imapTls ? " (TLS)" : ""}`);
  console.log(`SMTP: ${smtpUser}@${smtpHost}:${smtpPort}${smtpSecure ? " (TLS)" : " (STARTTLS)"}`);
  console.log(`From: ${fromAddress}`);
  console.log(`Allowlist: ${allowAll ? "(all)" : [...allowedSenders].join(", ")}`);
  console.log(`Poll interval: ${pollIntervalSec}s`);

  await pollLoop();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
