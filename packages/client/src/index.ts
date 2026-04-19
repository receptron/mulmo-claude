// @mulmobridge/client — shared socket.io client for all MulmoBridge bridges.

export {
  createBridgeClient,
  requireBearerToken,
  type MessageAck,
  type PushEvent,
  type BridgeClientOptions,
  type BridgeClient,
} from "./client.js";

export { readBridgeToken, TOKEN_FILE_PATH } from "./token.js";

export {
  mimeFromExtension,
  isImageMime,
  isPdfMime,
  isSupportedAttachmentMime,
  isNativeAttachmentMime,
  parseDataUrl,
  buildDataUrl,
  type ParsedDataUrl,
} from "./mime.js";
