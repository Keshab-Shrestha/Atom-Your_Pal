// The runtime matches an answer it may already hold by the SHA-256 of its exact text (foreground.list `pendingAnswers`), so the words themselves
// need not be sent just to ask. Web Crypto is available in a secure context, which 127.0.0.1 is.

export async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
