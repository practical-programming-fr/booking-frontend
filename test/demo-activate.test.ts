import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  activateDemoOutage: vi.fn(),
}));

vi.mock("@/lib/api", () => {
  class ApiError extends Error {
    constructor(
      public readonly status: number,
      message: string,
      public readonly url: string,
    ) {
      super(message);
    }
  }

  return {
    ApiError,
    bookingApi: {
      activateDemoOutage: mocks.activateDemoOutage,
    },
  };
});

import { ApiError } from "@/lib/api";
import { GET } from "@/app/demo/activate/route";

const sessionId = "11111111-1111-4111-8111-111111111111";

describe("demo activation link", () => {
  beforeEach(() => {
    mocks.activateDemoOutage.mockReset();
    mocks.activateDemoOutage.mockResolvedValue({
      ok: true,
      demoSessionId: "22222222-2222-4222-8222-222222222222",
      bookingSessionId: sessionId,
      expiresAt: "2026-08-01T14:00:00.000Z",
    });
  });

  it("binds the existing browser session and removes the token from the URL", async () => {
    const request = new NextRequest(
      "https://book.flylo-air.com/demo/activate?token=one-time-token-value-that-is-long-enough",
      { headers: { Cookie: `flylo_booking_session=${sessionId}` } },
    );

    const response = await GET(request);

    expect(mocks.activateDemoOutage).toHaveBeenCalledWith(
      "one-time-token-value-that-is-long-enough",
      sessionId,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://book.flylo-air.com/");
    expect(response.headers.get("set-cookie")).toContain(
      `flylo_booking_session=${sessionId}`,
    );
  });

  it("redirects to a same-origin return path after bind", async () => {
    const returnPath = "/search?from=LHR&to=HND&date=2026-08-15";
    const request = new NextRequest(
      `https://book.flylo-air.com/demo/activate?token=one-time-token-value-that-is-long-enough&return=${encodeURIComponent(returnPath)}`,
      { headers: { Cookie: `flylo_booking_session=${sessionId}` } },
    );

    const response = await GET(request);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `https://book.flylo-air.com${returnPath}`,
    );
  });

  it("rejects open-redirect return values and falls back to /", async () => {
    for (const unsafe of ["//evil.example", "https://evil.example/phish", "search"]) {
      const request = new NextRequest(
        `https://book.flylo-air.com/demo/activate?token=one-time-token-value-that-is-long-enough&return=${encodeURIComponent(unsafe)}`,
        { headers: { Cookie: `flylo_booking_session=${sessionId}` } },
      );

      const response = await GET(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("https://book.flylo-air.com/");
    }
  });

  it("creates a booking session for a fresh browser profile", async () => {
    const request = new NextRequest(
      "https://book.flylo-air.com/demo/activate?token=one-time-token-value-that-is-long-enough",
    );

    const response = await GET(request);
    const boundSessionId = mocks.activateDemoOutage.mock.calls[0]?.[1];

    expect(boundSessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(response.headers.get("set-cookie")).toContain(
      `flylo_booking_session=${boundSessionId}`,
    );
  });

  it("shows an expired-link error instead of redirecting", async () => {
    mocks.activateDemoOutage.mockRejectedValue(
      new ApiError(410, "Expired", "https://booking-api.flylo-air.com"),
    );
    const request = new NextRequest(
      "https://book.flylo-air.com/demo/activate?token=expired-token-value-that-is-long-enough",
      { headers: { Cookie: `flylo_booking_session=${sessionId}` } },
    );

    const response = await GET(request);

    expect(response.status).toBe(410);
    const body = await response.text();
    expect(body).toContain("activation link expired");
    expect(body).toContain("prepare or trigger");
  });

  it("shows an already-used error instead of redirecting", async () => {
    mocks.activateDemoOutage.mockRejectedValue(
      new ApiError(409, "Used", "https://booking-api.flylo-air.com"),
    );
    const request = new NextRequest(
      "https://book.flylo-air.com/demo/activate?token=used-token-value-that-is-long-enough",
      { headers: { Cookie: `flylo_booking_session=${sessionId}` } },
    );

    const response = await GET(request);

    expect(response.status).toBe(409);
    const body = await response.text();
    expect(body).toContain("already used");
    expect(body).toContain("prepare or trigger");
  });
});
