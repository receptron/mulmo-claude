// Pure parsing helpers for the XMPP bridge.

export function splitJid(fullJid: string): { username: string; domain: string } {
  const atIdx = fullJid.indexOf("@");
  if (atIdx < 0) return { username: "", domain: "" };
  return { username: fullJid.slice(0, atIdx), domain: fullJid.slice(atIdx + 1) };
}

export function bareJid(fullJid: string): string {
  const slashIdx = fullJid.indexOf("/");
  return (slashIdx < 0 ? fullJid : fullJid.slice(0, slashIdx)).toLowerCase();
}

export interface ParsedStanza {
  from: string;
  senderBare: string;
  body: string;
}

export interface StanzaFields {
  isMessage: boolean;
  type: string | undefined;
  from: unknown;
  body: string | null;
  selfBare: string;
}

/**
 * Reduce the raw fields lifted out of an XMPP message stanza to the
 * actionable {from, senderBare, body} triple. Returns null when the
 * stanza is not a chat/normal message, fields are missing, or the
 * stanza is an echo of our own message.
 *
 * Pure — no XmlElement dependency, no allowlist check. The caller
 * supplies the fields after touching the @xmpp/client API.
 */
export function parseStanzaFields(fields: StanzaFields): ParsedStanza | null {
  if (!fields.isMessage) return null;
  const stanzaType = fields.type ?? "";
  if (stanzaType !== "chat" && stanzaType !== "normal") return null;
  const from = typeof fields.from === "string" ? fields.from : "";
  const body = fields.body ?? "";
  if (!from || !body) return null;
  const senderBare = bareJid(from);
  if (senderBare === fields.selfBare) return null; // ignore echo
  return { from, senderBare, body };
}
