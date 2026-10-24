import { db } from "./db";
import { extractAll, type Experience } from "./extract";

export type Post = {
  id: string;
  url: string;
  author: string;
  authorHeadline: string;
  authorUrl: string; // poster's LinkedIn profile or company page
  postedAt: string; // as shown on LinkedIn, e.g. "3d"
  text: string;
  searchKeyword: string; // keyword used on LinkedIn when captured
  capturedAt: string;
  emails: string[];
  experience: Experience | null; // years the post asks for
  roles: string[];
  companies: string[];
  technologies: string[];
};

export type IncomingPost = Partial<Pick<Post, "id" | "url" | "author" | "authorHeadline" | "authorUrl" | "postedAt" | "text" | "searchKeyword">>;

async function readAll(): Promise<Post[]> {
  const posts = Object.values(await db.getAll<Post>("posts"));
  // Re-extract on read so improvements to the extractor apply to old posts too
  return posts.map((p) => ({ ...p, ...extractAll(p.text, p.authorHeadline) }));
}

export async function savePosts(incoming: IncomingPost[]) {
  const byId = new Map(Object.entries(await db.getAll<Post>("posts")));
  const changed: Record<string, Post> = {};
  const removed: string[] = [];
  let added = 0;
  for (const raw of incoming) {
    const text = (raw.text ?? "").trim();
    if (!text) continue;
    const fallbackId = `${raw.author}:${text.slice(0, 80)}`;
    const id = raw.id || raw.url || fallbackId;
    // Same post captured earlier without a link: replace that entry
    const previous = byId.get(id) ?? byId.get(fallbackId);
    if (id !== fallbackId && byId.has(fallbackId)) {
      byId.delete(fallbackId);
      removed.push(fallbackId);
    }
    const authorHeadline = raw.authorHeadline ?? "";
    const post: Post = {
      id,
      url: raw.url || previous?.url || "",
      author: raw.author ?? "",
      authorHeadline,
      authorUrl: raw.authorUrl || previous?.authorUrl || "",
      postedAt: raw.postedAt ?? "",
      text,
      searchKeyword: raw.searchKeyword ?? "",
      capturedAt: previous?.capturedAt ?? new Date().toISOString(),
      ...extractAll(text, authorHeadline),
    };
    if (!previous) added++;
    byId.set(id, post);
    changed[id] = post;
  }
  await db.put("posts", changed, removed);
  return { added, total: byId.size };
}

export type SearchOptions = {
  withEmailOnly?: boolean;
  expMin?: number; // keep posts whose asked experience overlaps [expMin, expMax]
  expMax?: number;
  includeNoExp?: boolean; // keep posts that don't mention experience
};

// Shared by the posts list and the Excel export so both show the same posts
export function searchOptionsFrom(params: URLSearchParams): SearchOptions {
  const num = (k: string) => (params.get(k) ? Number(params.get(k)) : undefined);
  return {
    withEmailOnly: params.get("withEmail") === "1",
    expMin: num("expMin"),
    expMax: num("expMax"),
    includeNoExp: params.get("noExp") === "1",
  };
}

function matchesExperience(p: Post, o: SearchOptions) {
  if (o.expMin === undefined && o.expMax === undefined) return true;
  if (!p.experience) return !!o.includeNoExp;
  const lo = o.expMin ?? 0;
  const hi = o.expMax ?? Infinity;
  // "3+ yrs" counts as 3; "2-4 yrs" overlaps 2..4
  return p.experience.min <= hi && (p.experience.max ?? p.experience.min) >= lo;
}

export async function searchPosts(q: string, opts: SearchOptions = {}) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const posts = await readAll();
  return posts
    .filter((p) => {
      if (opts.withEmailOnly && p.emails.length === 0) return false;
      if (!matchesExperience(p, opts)) return false;
      const hay = [p.text, p.author, p.authorHeadline, p.searchKeyword, ...p.roles, ...p.companies, ...p.technologies]
        .join(" ")
        .toLowerCase();
      return terms.every((t) => hay.includes(t));
    })
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
}

export async function getPost(id: string) {
  return (await readAll()).find((p) => p.id === id);
}

// Emails already mailed, so the same HR isn't contacted twice
export type SentRecord = { sentAt: string; postId: string; subject: string };

export function getSent() {
  return db.getAll<SentRecord>("sent");
}

export function markSent(email: string, record: SentRecord) {
  return db.put("sent", { [email.toLowerCase()]: record });
}

export function clearPosts() {
  return db.clear("posts");
}
