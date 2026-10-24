import { NextRequest, NextResponse } from "next/server";
import { ingestToken, portalPassword, SESSION_COOKIE, sessionValue } from "@/lib/auth";

export const config = { matcher: ["/((?!_next/|favicon.ico).*)"] };

const CORS = { "Access-Control-Allow-Origin": "*" };

export async function middleware(req: NextRequest) {
  const password = portalPassword();
  if (!password) return NextResponse.next(); // no password configured (local use)

  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();

  // The browser extension adds posts with a token instead of a login cookie
  if (pathname === "/api/posts" && req.method === "OPTIONS") return NextResponse.next();
  if (pathname === "/api/posts" && req.method === "POST") {
    if (req.headers.get("x-ingest-token") === ingestToken()) return NextResponse.next();
    return NextResponse.json(
      { error: "Wrong or missing password: set it in the extension under Settings → Portal password" },
      { status: 401, headers: CORS }
    );
  }

  if (req.cookies.get(SESSION_COOKIE)?.value === (await sessionValue(password))) return NextResponse.next();

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  const login = new URL("/login", req.url);
  login.searchParams.set("next", pathname + req.nextUrl.search);
  return NextResponse.redirect(login);
}
