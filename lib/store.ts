import { promises as fs } from "fs";
import path from "path";
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

// DATA_DIR lets a test server use separate data
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "posts.json");

async function readAll(): Promise<Post[]> {
  try {
    const posts: Post[] = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
    // Re-extract on read so improvements to the extractor apply to old posts too
    return posts.map((p) => ({ ...p, ...extractAll(p.text, p.authorHeadline) }));
  } catch {
    return [];
  }
}

async function writeAll(posts: Post[]) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  const tmp = `${DATA_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(posts, null, 2));
  await fs.rename(tmp, DATA_FILE);
}

// Serialize writes so concurrent requests don't clobber the file
let queue: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

export function savePosts(incoming: IncomingPost[]) {
  return locked(async () => {
    const posts = await readAll();
    const byId = new Map(posts.map((p) => [p.id, p]));
    let added = 0;
    for (const raw of incoming) {
      const text = (raw.text ?? "").trim();
      if (!text) continue;
      const fallbackId = `${raw.author}:${text.slice(0, 80)}`;
      const id = raw.id || raw.url || fallbackId;
      // Same post captured earlier without a link: replace that entry
      const previous = byId.get(id) ?? byId.get(fallbackId);
      if (id !== fallbackId && byId.has(fallbackId)) byId.delete(fallbackId);
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
    }
    const all = [...byId.values()];
    await writeAll(all);
    return { added, total: all.length };
  });
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
const SENT_FILE = path.join(DATA_DIR, "sent.json");

export async function getSent(): Promise<Record<string, SentRecord>> {
  try {
    return JSON.parse(await fs.readFile(SENT_FILE, "utf8"));
  } catch {
    return {};
  }
}

export function markSent(email: string, record: SentRecord) {
  return locked(async () => {
    const sent = await getSent();
    sent[email.toLowerCase()] = record;
    await fs.mkdir(path.dirname(SENT_FILE), { recursive: true });
    await fs.writeFile(SENT_FILE, JSON.stringify(sent, null, 2));
  });
}

export function clearPosts() {
  return locked(() => writeAll([]));
}
