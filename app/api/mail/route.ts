import { NextRequest, NextResponse } from "next/server";
import { callMailSender, draftFor, EXPERIENCE_LEVELS, type Draft } from "@/lib/mail";
import { getPost, getSent, markSent } from "@/lib/store";

export const dynamic = "force-dynamic";

// POST { action: "draft" | "preview" | "send", postId, email, ...overrides }
//  draft   -> auto-generated subject/role/company/experience for this post
//  preview -> the personalised email HTML (from the mail sender), nothing is sent
//  send    -> sends via the mail sender and records the email as sent
export async function POST(req: NextRequest) {
  // JSON-only: browsers can't send this cross-site without a CORS preflight (which this route
  // doesn't allow), so other websites can't trigger emails through the local portal
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "Expected application/json" }, { status: 415 });
  }
  const body = await req.json().catch(() => null);
  const { action, postId, email, force, ...overrides } = body ?? {};
  if (!postId || !email) return NextResponse.json({ error: "postId and email are required" }, { status: 400 });

  const post = await getPost(postId);
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });
  if (!post.emails.includes(email)) return NextResponse.json({ error: "Email is not in this post" }, { status: 400 });

  const draft: Draft = { ...draftFor(post, email), ...pickOverrides(overrides) };
  if (action === "draft") return NextResponse.json({ draft });

  try {
    if (action === "preview") {
      const { html } = await callMailSender(draft, true);
      return NextResponse.json({ draft, html });
    }
    if (action === "send") {
      const already = (await getSent())[email.toLowerCase()];
      if (already && !force) {
        return NextResponse.json({ error: `Already sent on ${new Date(already.sentAt).toLocaleString()}`, already }, { status: 409 });
      }
      await callMailSender(draft, false);
      const record = { sentAt: new Date().toISOString(), postId, subject: draft.subject };
      await markSent(email, record);
      return NextResponse.json({ ok: true, sent: record });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

// Only accept fields the user can edit in the compose dialog
function pickOverrides(o: Record<string, unknown>): Partial<Draft> {
  const out: Partial<Draft> = {};
  if (typeof o.subject === "string" && o.subject.trim()) out.subject = o.subject.trim();
  if (typeof o.role === "string" && o.role.trim()) out.role = o.role.trim();
  if (typeof o.company === "string") out.company = o.company.trim();
  if (typeof o.experienceLevel === "string" && o.experienceLevel in EXPERIENCE_LEVELS) {
    out.experienceLevel = o.experienceLevel as Draft["experienceLevel"];
  }
  return out;
}
