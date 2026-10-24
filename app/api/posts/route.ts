import { NextRequest, NextResponse } from "next/server";
import { usingRedis } from "@/lib/db";
import { clearPosts, getSent, savePosts, searchOptionsFrom, searchPosts, type IncomingPost } from "@/lib/store";

export const dynamic = "force-dynamic";

// The browser extension posts here from linkedin.com, so allow cross-origin calls
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Ingest-Token",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const [posts, sent] = await Promise.all([searchPosts(q, searchOptionsFrom(req.nextUrl.searchParams)), getSent()]);
  return NextResponse.json({ posts, sent, loginEnabled: !!process.env.PORTAL_PASSWORD }, { headers: CORS });
}

export async function POST(req: NextRequest) {
  const token = process.env.INGEST_TOKEN;
  if (token && req.headers.get("x-ingest-token") !== token) {
    return NextResponse.json({ error: "Invalid ingest token" }, { status: 401, headers: CORS });
  }
  const body = await req.json().catch(() => null);
  const posts: IncomingPost[] | undefined = body?.posts;
  if (!Array.isArray(posts)) {
    return NextResponse.json({ error: "Expected { posts: [...] }" }, { status: 400, headers: CORS });
  }
  try {
    return NextResponse.json(await savePosts(posts), { headers: CORS });
  } catch (e) {
    // On Vercel this is usually a missing database: files can't be written there
    const error = `Could not save posts: ${(e as Error).message}${usingRedis ? "" : ". No database connected (add Upstash in Vercel → Storage, then redeploy)"}`;
    return NextResponse.json({ error }, { status: 500, headers: CORS });
  }
}

export async function DELETE() {
  await clearPosts();
  return NextResponse.json({ ok: true }, { headers: CORS });
}
