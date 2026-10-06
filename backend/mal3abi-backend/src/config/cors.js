export function normalizeOrigin(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function parseOrigins(...values) {
  return [...new Set(values.flatMap((value) => String(value || "").split(",")).map(normalizeOrigin).filter(Boolean))];
}

const parsedOrigins = parseOrigins(
  process.env.FRONTEND_URL,
  process.env.PUBLIC_FRONTEND_URL,
  process.env.CORS_ORIGIN,
  process.env.CORS_ORIGINS,
  process.env.NODE_ENV === "test" ? "http://localhost:3000" : undefined,
);

// ✅ Allow origins from all supported env names instead of only the first populated one.
export const allowedOrigins = parsedOrigins.length > 0 ? parsedOrigins : ["http://localhost:3000"];

export function isOriginAllowed(origin) {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (allowedOrigins.includes(normalized)) return true;
  // In development/test, allow Vercel preview deploys for convenience.
  // In production, ONLY explicitly-configured origins are accepted.
  if (process.env.NODE_ENV !== "production") {
    try {
      const url = new URL(normalized);
      if (url.hostname.endsWith(".vercel.app")) {
        return true;
      }
    } catch {}
  }
  return false;
}
