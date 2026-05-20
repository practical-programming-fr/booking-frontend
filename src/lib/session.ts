// Browser session identity. We don't have auth in v1, so each browser keeps
// a UUID in localStorage AND mirrors it into a cookie so Server Components
// can authenticate to the booking-backend. We send the same UUID as
// `x-booking-session` on every API request; the backend uses it to scope
// draft bookings to this device.

const STORAGE_KEY = "flylo:booking:session";
const COOKIE_KEY = "flylo_booking_session";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function generateUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // RFC4122 v4 fallback
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return (
    Array.from(bytes.slice(0, 4), hex).join("") +
    "-" +
    Array.from(bytes.slice(4, 6), hex).join("") +
    "-" +
    Array.from(bytes.slice(6, 8), hex).join("") +
    "-" +
    Array.from(bytes.slice(8, 10), hex).join("") +
    "-" +
    Array.from(bytes.slice(10, 16), hex).join("")
  );
}

function setSessionCookie(id: string): void {
  if (typeof document === "undefined") return;
  const isSecure = typeof window !== "undefined" && window.location.protocol === "https:";
  document.cookie =
    `${COOKIE_KEY}=${id}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax` +
    (isSecure ? "; secure" : "");
}

function readSessionCookie(): string | null {
  if (typeof document === "undefined") return null;
  for (const pair of document.cookie.split(";")) {
    const [name, ...rest] = pair.trim().split("=");
    if (name === COOKIE_KEY) {
      return rest.join("=") || null;
    }
  }
  return null;
}

export function getOrCreateSessionId(): string {
  if (typeof window === "undefined") {
    return "";
  }
  let id =
    window.localStorage.getItem(STORAGE_KEY) ?? readSessionCookie() ?? null;
  if (!id) {
    id = generateUuid();
  }
  window.localStorage.setItem(STORAGE_KEY, id);
  setSessionCookie(id);
  return id;
}

/** Server-side: read the session UUID from the request cookie if present. */
export async function getSessionIdForServer(): Promise<string> {
  if (typeof window !== "undefined") return "";
  try {
    const { cookies } = await import("next/headers");
    const store = await cookies();
    return store.get(COOKIE_KEY)?.value ?? "";
  } catch {
    return "";
  }
}

export const SESSION_COOKIE_NAME = COOKIE_KEY;
