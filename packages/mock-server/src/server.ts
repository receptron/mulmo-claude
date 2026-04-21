import http from "http";
import express from "express";
import { Server as IOServer } from "socket.io";
import { CHAT_SOCKET_PATH, CHAT_SOCKET_EVENTS } from "@mulmobridge/protocol";
import { handleMessage, type MessagePayload } from "./handlers.js";
import { createLogger, type MockLogger } from "./logger.js";

export interface MockServerOptions {
  port: number;
  token: string;
  slowMs: number;
  alwaysError: boolean;
  rejectAuth: boolean;
  verbose: boolean;
  logFile?: string;
}

export function createMockServer(opts: MockServerOptions): void {
  const log = createLogger(opts.verbose, opts.logFile);
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);

  const io = new IOServer(server, {
    path: CHAT_SOCKET_PATH,
    cors: { origin: true, credentials: true },
    transports: ["websocket"],
  });

  printBanner(opts, log);

  // ── Auth middleware ────────────────────────────────────────────

  io.use((socket, next) => {
    if (opts.rejectAuth) {
      log.verbose(`  auth: REJECTED (--reject-auth mode)`);
      return next(new Error("server auth not ready"));
    }
    const auth = socket.handshake.auth as Record<string, unknown>;
    const transportId = auth?.transportId;
    const token = auth?.token;

    if (!transportId || typeof transportId !== "string") {
      log.verbose(`  auth: REJECTED (transportId missing)`);
      return next(new Error("transportId is required"));
    }
    if (!token || typeof token !== "string") {
      log.verbose(`  auth: REJECTED (token missing)`);
      return next(new Error("token is required"));
    }
    if (token !== opts.token) {
      log.verbose(`  auth: REJECTED (token mismatch: got "${token.slice(0, 8)}…")`);
      return next(new Error("invalid token"));
    }
    log.verbose(`  auth: { transportId: "${transportId}", token: valid }`);
    next();
  });

  // ── Connection handling ───────────────────────────────────────

  io.on("connection", (socket) => {
    const auth = socket.handshake.auth as { transportId: string };
    const transportId = auth.transportId;
    socket.join(`bridge:${transportId}`);

    log.info(`CONNECT  sid=${socket.id} transportId=${transportId}`);

    socket.on(CHAT_SOCKET_EVENTS.message, async (payload: MessagePayload, ack: (response: unknown) => void) => {
      log.info(`← MESSAGE  sid=${socket.id} chat=${payload.externalChatId} len=${(payload.text ?? "").length}${formatAttachmentSummary(payload)}`);
      log.verbose(`  payload: ${JSON.stringify(sanitizePayload(payload))}`);

      if (opts.slowMs > 0) {
        await new Promise((r) => setTimeout(r, opts.slowMs));
      }

      const response = handleMessage(payload, opts);
      const ackDetail = response.ok ? `reply="${truncate(response.reply ?? "", 60)}"` : `error="${response.error}"`;
      log.info(`→ ACK  sid=${socket.id} ok=${response.ok} ${ackDetail}`);
      log.verbose(`  ack: ${JSON.stringify(response)}`);

      ack(response);
    });

    socket.on("disconnect", (reason) => {
      log.info(`DISCONNECT  sid=${socket.id} reason=${reason}`);
    });
  });

  // ── Push endpoint ─────────────────────────────────────────────

  app.post("/mock/push", (req, res) => {
    const { transportId, chatId, message } = req.body as {
      transportId?: string;
      chatId?: string;
      message?: string;
    };
    if (!transportId || !chatId || !message) {
      res.status(400).json({ error: "transportId, chatId, and message are required" });
      return;
    }
    io.to(`bridge:${transportId}`).emit(CHAT_SOCKET_EVENTS.push, {
      chatId,
      message,
    });
    log.info(`→ PUSH  transportId=${transportId} chatId=${chatId} message="${truncate(message, 60)}"`);
    res.json({ ok: true });
  });

  // ── Health endpoint ───────────────────────────────────────────

  app.get("/api/health", (_req, res) => {
    res.json({ status: "OK", mock: true });
  });

  // ── Start ─────────────────────────────────────────────────────

  server.listen(opts.port, "127.0.0.1", () => {
    log.info(`listening on http://localhost:${opts.port}`);
  });

  process.on("SIGINT", () => {
    log.info("shutting down...");
    printReportHint(log);
    io.close();
    server.close(() => process.exit(0));
    // Safety net — if server.close() hangs (stuck connections),
    // force exit after 3 seconds.
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

// ── Helpers ───────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function formatAttachmentSummary(payload: MessagePayload): string {
  if (!payload.attachments || payload.attachments.length === 0) return "";
  const parts = payload.attachments.map((a) => {
    const size = Math.ceil((a.data.length * 3) / 4);
    const name = a.filename ? ` ${a.filename}` : "";
    return `${a.mimeType} ${formatBytes(size)}${name}`;
  });
  return ` +${parts.length}attachment(s): [${parts.join(", ")}]`;
}

function sanitizePayload(payload: MessagePayload): Record<string, unknown> {
  const clean: Record<string, unknown> = {
    externalChatId: payload.externalChatId,
    text: payload.text,
  };
  if (payload.attachments && payload.attachments.length > 0) {
    clean.attachments = payload.attachments.map((a) => ({
      mimeType: a.mimeType,
      data: `<base64 ${formatBytes(Math.ceil((a.data.length * 3) / 4))}>`,
      ...(a.filename && { filename: a.filename }),
    }));
  }
  return clean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function printBanner(opts: MockServerOptions, log: MockLogger): void {
  log.raw("══════════════════════════════════════════════════════");
  log.raw("@mulmobridge/mock-server v0.1.0");
  log.raw(`node: ${process.version} | os: ${process.platform} ${process.arch} | socket.io: 4.x`);
  log.raw(`token: ${opts.token}`);
  const modeParts = ["echo"];
  if (opts.alwaysError) modeParts.push("error");
  if (opts.slowMs > 0) modeParts.push(`slow: ${opts.slowMs}ms`);
  if (opts.rejectAuth) modeParts.push("reject-auth");
  log.raw(`mode: ${modeParts.join(" | ")}`);
  log.raw("══════════════════════════════════════════════════════");
}

function printReportHint(log: MockLogger): void {
  log.raw("──────────────────────────────────────────────────────");
  log.raw("To report a bug, paste the output above into:");
  log.raw("  https://github.com/receptron/mulmoclaude/issues/new");
  log.raw("Include: what you expected vs. what happened.");
  log.raw("──────────────────────────────────────────────────────");
}
