// Browser session identity. We don't have auth in v1, so each browser keeps
// a UUID in localStorage and we send it as `x-booking-session` on every API
// request. The backend uses it to scope draft bookings to this device.
//
// On the server we can't access localStorage. Server Components either pass
// `null` (for public, non-personalised reads) or read from a cookie if we
// ever start mirroring the session id there. For now the API client treats
// a missing session as "no header" and the backend allows that for reads.

const STORAGE_KEY = "flylo:booking:session";

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

export function getOrCreateSessionId(): string {
  if (typeof window === "undefined") {
    return "";
  }
  let id = window.localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = generateUuid();
    window.localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}

// Server-side helper: read the session id from a cookie if we ever mirror it.
// Today this returns an empty string and the API client omits the header,
// which is fine for public reads.
export function getSessionIdForServer(): string {
  return "";
}
