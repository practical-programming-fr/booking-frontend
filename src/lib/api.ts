// Typed client for the booking-backend HTTP API. Server-side fetches use
// BOOKING_API_URL; client-side fetches use NEXT_PUBLIC_BOOKING_API_URL.
//
// Every request carries the browser's session id (x-booking-session) so the
// backend can scope draft bookings to this device without authentication.

import { getSessionIdForServer } from "./session";

export type Airport = {
  iata: string;
  icao: string | null;
  city: string;
  country: string;
  continent:
    | "Africa"
    | "Asia"
    | "Europe"
    | "North America"
    | "Oceania"
    | "South America";
  lat: number;
  lon: number;
  tz: string;
  isHub: boolean;
};

export type Route = {
  id: number;
  from: string;
  to: string;
  durationMin: number;
  fareFromEur: number;
  freqPerWeek: number;
  haul: "short" | "long";
  aircraft: string;
};

export type SearchFare = {
  cabin: "A" | "P" | "L";
  baseEur: number;
  totalForPaxEur: number;
  seatsAvailable: number;
};

export type SearchResult = {
  id: string;
  flightNo: string;
  aircraft: string;
  from: string;
  to: string;
  departAt: string;
  arriveAt: string;
  durationMin: number;
  status: string;
  fares: SearchFare[];
  cheapestFromEur: number | null;
};

export type SearchResponse = {
  from: string;
  to: string;
  date: string;
  pax: number;
  cabin?: "A" | "P" | "L";
  results: SearchResult[];
};

export type CalendarDay = {
  date: string;
  fromEur: number;
  flights: number;
};

export type CalendarResponse = {
  from: string;
  to: string;
  month: string;
  cabin: "A" | "P" | "L";
  days: CalendarDay[];
};

export type FlightDetail = {
  id: string;
  flightNo: string;
  status: string;
  departAt: string;
  arriveAt: string;
  durationMin: number;
  aircraft: {
    code: string;
    model: string;
    seats: number;
    rangeKm: number;
    cruiseKmh: number;
    note: string | null;
  };
  from: { iata: string; city: string; country: string; tz: string };
  to: { iata: string; city: string; country: string; tz: string };
  route: { haul: "short" | "long"; freqPerWeek: number };
  fares: Array<{
    cabin: "A" | "P" | "L";
    cabinName: string;
    deck: string | null;
    dining: string | null;
    baseEur: number;
    taxesEur: number;
    surfaceEur: number;
    seatsTotal: number;
    seatsAvailable: number;
  }>;
};

export type SeatMap = {
  flight: { id: string; flightNo: string; aircraft: string };
  cabin: "A" | "P" | "L";
  layout: {
    rows: Array<{ row: number; columns: string[]; zone: string; priceEur: number }>;
  };
  seats: Array<{
    seatId: string;
    zone: string;
    priceEur: number;
    status: "available" | "held" | "taken" | "blocked";
  }>;
};

class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly url: string,
  ) {
    super(`${status} ${message} (${url})`);
    this.name = "ApiError";
  }
}

type ApiRequestInit = RequestInit & {
  signal?: AbortSignal;
  // When the caller is a Server Component, we read from process.env directly.
  // Pass `sessionId: null` to skip the session header (e.g. for public reads).
  sessionId?: string | null;
};

function getBaseUrl(): string {
  if (typeof window === "undefined") {
    return (
      process.env.BOOKING_API_URL ??
      process.env.NEXT_PUBLIC_BOOKING_API_URL ??
      "http://localhost:8787"
    );
  }
  return (
    process.env.NEXT_PUBLIC_BOOKING_API_URL ??
    process.env.BOOKING_API_URL ??
    "http://localhost:8787"
  );
}

async function request<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}${path}`;
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (init.sessionId !== null) {
    const sessionId =
      init.sessionId ??
      (typeof window === "undefined"
        ? getSessionIdForServer()
        : (await import("./session")).getOrCreateSessionId());
    if (sessionId) {
      headers.set("x-booking-session", sessionId);
    }
  }

  const res = await fetch(url, {
    ...init,
    headers,
    // Server-side fetches default to no caching so we never serve stale
    // search results. Callers can opt in to `next: { revalidate: ... }`
    // for read-mostly resources like /airports.
    cache: init.cache ?? "no-store",
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      message = body.error?.message ?? message;
    } catch {
      // ignore JSON parse failure
    }
    throw new ApiError(res.status, message, url);
  }

  return (await res.json()) as T;
}

export const bookingApi = {
  airports: async (init?: ApiRequestInit): Promise<{ airports: Airport[] }> =>
    request("/v1/airports", { ...init, cache: "force-cache", next: { revalidate: 3600 } } as ApiRequestInit),

  routes: async (
    params: { from?: string; to?: string } = {},
    init?: ApiRequestInit,
  ): Promise<{ routes: Route[] }> => {
    const search = new URLSearchParams();
    if (params.from) search.set("from", params.from);
    if (params.to) search.set("to", params.to);
    const qs = search.toString();
    return request(`/v1/routes${qs ? `?${qs}` : ""}`, init);
  },

  searchFlights: async (
    params: {
      from: string;
      to: string;
      date: string;
      pax?: number;
      cabin?: "A" | "P" | "L";
    },
    init?: ApiRequestInit,
  ): Promise<SearchResponse> => {
    const search = new URLSearchParams({
      from: params.from,
      to: params.to,
      date: params.date,
    });
    if (params.pax != null) search.set("pax", String(params.pax));
    if (params.cabin) search.set("cabin", params.cabin);
    return request(`/v1/flights/search?${search.toString()}`, init);
  },

  calendar: async (
    params: { from: string; to: string; month: string; cabin?: "A" | "P" | "L" },
    init?: ApiRequestInit,
  ): Promise<CalendarResponse> => {
    const search = new URLSearchParams({
      from: params.from,
      to: params.to,
      month: params.month,
    });
    if (params.cabin) search.set("cabin", params.cabin);
    return request(`/v1/flights/calendar?${search.toString()}`, init);
  },

  flight: async (id: string, init?: ApiRequestInit): Promise<{ flight: FlightDetail }> =>
    request(`/v1/flights/${encodeURIComponent(id)}`, init),

  seatMap: async (
    id: string,
    cabin: "A" | "P" | "L",
    init?: ApiRequestInit,
  ): Promise<SeatMap> =>
    request(
      `/v1/flights/${encodeURIComponent(id)}/seat-map?cabin=${cabin}`,
      init,
    ),
};

export { ApiError };
