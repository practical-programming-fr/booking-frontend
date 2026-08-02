import { NextRequest, NextResponse } from "next/server";
import { ApiError, bookingApi } from "@/lib/api";
import {
  isBookingSessionId,
  SESSION_COOKIE_MAX_AGE_SECONDS,
  SESSION_COOKIE_NAME,
} from "@/lib/session";

export const dynamic = "force-dynamic";

function safeReturnPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

function errorPage(message: string, status: number): Response {
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>FlyLo demo activation</title>
  </head>
  <body style="font-family: system-ui; max-width: 42rem; margin: 4rem auto; padding: 0 1.5rem;">
    <h1>Demo activation failed</h1>
    <p>${message}</p>
    <p><a href="/">Return to FlyLo Booking</a></p>
  </body>
</html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function GET(request: NextRequest): Promise<Response> {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return errorPage("The activation link is missing its token.", 400);
  }

  const cookieSessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const bookingSessionId = isBookingSessionId(cookieSessionId)
    ? cookieSessionId
    : crypto.randomUUID();

  try {
    await bookingApi.activateDemoOutage(token, bookingSessionId);
  } catch (error) {
    if (error instanceof ApiError) {
      const message =
        error.status === 410
          ? "This activation link expired. Ask Cursor to prepare or trigger a new scoped outage."
          : error.status === 409
            ? "This activation link was already used. Ask Cursor to prepare or trigger a new scoped outage."
            : "The booking service could not activate this scoped outage.";
      return errorPage(message, error.status);
    }
    return errorPage("The booking service could not activate this scoped outage.", 500);
  }

  const returnPath = safeReturnPath(request.nextUrl.searchParams.get("return"));
  const response = NextResponse.redirect(new URL(returnPath, request.url), 303);
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: bookingSessionId,
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    httpOnly: false,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
