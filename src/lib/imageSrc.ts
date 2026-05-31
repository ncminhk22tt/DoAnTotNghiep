export function resolveSafeImageSrc(raw: string | null | undefined, fallback: string) {
  const src = raw?.trim();
  if (!src) return fallback;

  if (src.startsWith("/") || src.startsWith("https://") || src.startsWith("data:image/")) {
    return src;
  }

  // Avoid Mixed Content on HTTPS deployments when old DB rows still contain http:// upload URLs.
  return fallback;
}
