/**
 * Text Response Plugin - Type Definitions
 */

export interface TextResponseData {
  text: string;
  role?: "assistant" | "system" | "user";
  transportKind?: string;
}

export type TextResponseArgs = TextResponseData;
