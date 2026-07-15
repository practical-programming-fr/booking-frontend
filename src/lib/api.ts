// Typed client for the booking-backend HTTP API. Server-side fetches use
// BOOKING_API_URL; client-side fetches use NEXT_PUBLIC_BOOKING_API_URL.
//
// Every request carries the browser's session id (x-booking-session) so the
// backend can scope draft bookings to this device without authentication.
// On the server the session id comes from the `flylo_booking_session`
// cookie set by the client-side helper.

import { getSessionIdForServer, getOrCreateSessionId } from "./session";
import { resolveDemoSessionId, DEMO_SESSION_HEADER } from "./demo-session";

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

// --- Booking view (mirror of backend src/domain/types.ts) -----------------

export type BookingContact = {
  name?: string;
  email?: string;
  phone?: string;
};

export type BookingPassenger = {
  passengerNo: number;
  givenName: string;
  familyName: string;
  loyaltyNo: string | null;
  notes: string | null;
  seatId: string | null;
  mealId: string | null;
};

export type BookingSegment = {
  segmentNo: number;
  flightId: string;
  cabin: "A" | "P" | "L";
  flightNo: string;
  departAt: string;
  arriveAt: string;
  durationMin: number;
  aircraft: string;
  from: { iata: string; city: string; country: string; tz: string };
  to: { iata: string; city: string; country: string; tz: string };
};

export type BookingPayment = {
  id: string;
  provider: "mock" | "stripe_test";
  status: "pending" | "succeeded" | "failed" | "refunded";
  amountEur: number;
  cardholder: string | null;
  cardLast4: string | null;
  cardBrand: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type BookingTotals = {
  baseEur: number;
  seatsEur: number;
  mealsEur: number;
  taxesEur: number;
  surfaceEur: number;
  discountEur: number;
  totalEur: number;
};

export type Booking = {
  pnr: string;
  status: "draft" | "awaiting_payment" | "confirmed" | "cancelled";
  contact: BookingContact;
  pax: number;
  currency: "EUR";
  promoCode: string | null;
  totals: BookingTotals;
  holdExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  segments: BookingSegment[];
  passengers: BookingPassenger[];
  payments: BookingPayment[];
};

export type Trip = {
  pnr: string;
  status: Booking["status"];
  pax: number;
  totalEur: number;
  contact: BookingContact;
  createdAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  segment: {
    flightNo: string;
    cabin: "A" | "P" | "L";
    departAt: string;
    arriveAt: string;
    durationMin: number;
    from: { iata: string; city: string };
    to: { iata: string; city: string };
  } | null;
};

class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly url: string,
    public readonly code?: string,
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

async function resolveSessionId(
  override: string | null | undefined,
): Promise<string> {
  if (override === null) return "";
  if (override) return override;
  if (typeof window === "undefined") {
    return await getSessionIdForServer();
  }
  return getOrCreateSessionId();
}

async function request<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}${path}`;
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const sessionId = await resolveSessionId(init.sessionId);
  if (sessionId) {
    headers.set("x-booking-session", sessionId);
  }

  // Forward the per-session demo outage id when this browser is in a scoped
  // demo. The backend serves 500s only to requests carrying an active demo
  // session, so this is what makes "the site breaks for me only" work. Sourced
  // from the flylo_demo_session cookie in both server (RSC/route) and client
  // paths. No cookie means no header, so normal traffic is unaffected.
  const demoSessionId = await resolveDemoSessionId();
  if (demoSessionId) {
    headers.set(DEMO_SESSION_HEADER, demoSessionId);
  }

  const res = await fetch(url, {
    ...init,
    headers,
    cache: init.cache ?? "no-store",
  });

  if (!res.ok) {
    let message = res.statusText;
    let code: string | undefined;
    try {
      const body = (await res.json()) as {
        error?: { message?: string; code?: string };
      };
      message = body.error?.message ?? message;
      code = body.error?.code;
    } catch {
      // ignore JSON parse failure
    }
    throw new ApiError(res.status, message, url, code);
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

  // --- Booking writes --------------------------------------------------

  createBooking: async (
    input: {
      flightId: string;
      cabin: "A" | "P" | "L";
      pax: number;
      contact?: BookingContact;
    },
    init?: ApiRequestInit,
  ): Promise<{ booking: Booking }> =>
    request("/v1/bookings", {
      ...init,
      method: "POST",
      body: JSON.stringify(input),
    }),

  getBooking: async (
    pnr: string,
    opts: { email?: string } = {},
    init?: ApiRequestInit,
  ): Promise<{ booking: Booking }> => {
    const search = new URLSearchParams();
    if (opts.email) search.set("email", opts.email);
    const qs = search.toString();
    return request(
      `/v1/bookings/${encodeURIComponent(pnr)}${qs ? `?${qs}` : ""}`,
      init,
    );
  },

  updateContact: async (
    pnr: string,
    contact: BookingContact,
    init?: ApiRequestInit,
  ): Promise<{ booking: Booking }> =>
    request(`/v1/bookings/${encodeURIComponent(pnr)}/contact`, {
      ...init,
      method: "POST",
      body: JSON.stringify({ contact }),
    }),

  upsertPassengers: async (
    pnr: string,
    passengers: Array<{
      passengerNo: number;
      givenName: string;
      familyName: string;
      loyaltyNo?: string | null;
      notes?: string | null;
    }>,
    init?: ApiRequestInit,
  ): Promise<{ booking: Booking }> =>
    request(`/v1/bookings/${encodeURIComponent(pnr)}/passengers`, {
      ...init,
      method: "POST",
      body: JSON.stringify({ passengers }),
    }),

  assignSeats: async (
    pnr: string,
    assignments: Array<{ passengerNo: number; seatId: string | null }>,
    init?: ApiRequestInit,
  ): Promise<{ booking: Booking }> =>
    request(`/v1/bookings/${encodeURIComponent(pnr)}/seats`, {
      ...init,
      method: "POST",
      body: JSON.stringify({ assignments }),
    }),

  assignMeals: async (
    pnr: string,
    assignments: Array<{ passengerNo: number; mealId: string }>,
    init?: ApiRequestInit,
  ): Promise<{ booking: Booking }> =>
    request(`/v1/bookings/${encodeURIComponent(pnr)}/meals`, {
      ...init,
      method: "POST",
      body: JSON.stringify({ assignments }),
    }),

  applyPromo: async (
    pnr: string,
    code: string,
    init?: ApiRequestInit,
  ): Promise<{ booking: Booking }> =>
    request(`/v1/bookings/${encodeURIComponent(pnr)}/promo`, {
      ...init,
      method: "POST",
      body: JSON.stringify({ code }),
    }),

  removePromo: async (
    pnr: string,
    init?: ApiRequestInit,
  ): Promise<{ booking: Booking }> =>
    request(`/v1/bookings/${encodeURIComponent(pnr)}/promo`, {
      ...init,
      method: "POST",
      body: JSON.stringify({ code: "" }),
    }),

  createPaymentIntent: async (
    pnr: string,
    init?: ApiRequestInit,
  ): Promise<{
    intent: { paymentId: string; clientSecret: string; amountEur: number };
    booking: Booking;
  }> =>
    request(`/v1/bookings/${encodeURIComponent(pnr)}/payment-intent`, {
      ...init,
      method: "POST",
      body: JSON.stringify({}),
    }),

  confirmPayment: async (
    pnr: string,
    body: {
      paymentId: string;
      card: { cardholder: string; last4: string; brand?: string };
    },
    init?: ApiRequestInit,
  ): Promise<{ booking: Booking }> =>
    request(`/v1/bookings/${encodeURIComponent(pnr)}/confirm`, {
      ...init,
      method: "POST",
      body: JSON.stringify(body),
    }),

  cancelBooking: async (
    pnr: string,
    init?: ApiRequestInit,
  ): Promise<{ booking: Booking }> =>
    request(`/v1/bookings/${encodeURIComponent(pnr)}/cancel`, {
      ...init,
      method: "POST",
      body: JSON.stringify({}),
    }),

  myTrips: async (init?: ApiRequestInit): Promise<{ trips: Trip[] }> =>
    request("/v1/me/trips", init),
};

export { ApiError };
