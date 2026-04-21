// HTTP utility helpers shared across server code.

/**
 * Safely extract the response body text. Returns empty string
 * on any error (network reset, invalid encoding, etc.).
 * Replaces the repeated `.text().catch(() => "")` pattern.
 */
export async function safeResponseText(
  res: Response,
  maxLength = 200,
): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, maxLength);
  } catch {
    return "";
  }
}
