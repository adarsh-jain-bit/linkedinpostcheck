import { promises as fs } from "fs";
import path from "path";
import { Redis } from "@upstash/redis";

// Where posts and the sent-email log live:
//  - Upstash Redis when its env vars are set (Vercel: files written there don't persist)
//  - JSON files in ./data otherwise (local use)

export interface Backend {
  getAll<T>(collection: string): Promise<Record<string, T>>;
  put<T>(collection: string, entries: Record<string, T>, remove?: string[]): Promise<void>;
  clear(collection: string): Promise<void>;
}

// Vercel's Upstash integration may name the variables either way
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

function redisBackend(url: string, token: string): Backend {
  const redis = new Redis({ url, token });
  const key = (c: string) => `lpc:${c}`;
  return {
    async getAll<T>(collection: string) {
      const raw = (await redis.hgetall<Record<string, unknown>>(key(collection))) ?? {};
      const out: Record<string, T> = {};
      // The client parses JSON values itself; older entries may still be strings
      for (const [k, v] of Object.entries(raw)) out[k] = (typeof v === "string" ? JSON.parse(v) : v) as T;
      return out;
    },
    async put<T>(collection: string, entries: Record<string, T>, remove: string[] = []) {
      const p = redis.pipeline();
      if (Object.keys(entries).length) {
        p.hset(key(collection), Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, JSON.stringify(v)])));
      }
      if (remove.length) p.hdel(key(collection), ...remove);
      if (Object.keys(entries).length || remove.length) await p.exec();
    },
    async clear(collection: string) {
      await redis.del(key(collection));
    },
  };
}

function fileBackend(dir: string): Backend {
  const file = (c: string) => path.join(dir, `${c}.json`);
  // Serialize writes so concurrent requests don't clobber a file
  let queue: Promise<unknown> = Promise.resolve();
  const locked = <T,>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => {});
    return next;
  };
  // posts.json is an array (the original format); other collections are objects
  const read = async (c: string): Promise<Record<string, unknown>> => {
    try {
      const data = JSON.parse(await fs.readFile(file(c), "utf8"));
      return Array.isArray(data) ? Object.fromEntries(data.map((p: { id: string }) => [p.id, p])) : data;
    } catch {
      return {};
    }
  };
  const write = async (c: string, data: Record<string, unknown>) => {
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${file(c)}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(c === "posts" ? Object.values(data) : data, null, 2));
    await fs.rename(tmp, file(c));
  };
  return {
    getAll: async <T,>(c: string) => (await read(c)) as Record<string, T>,
    put: (c, entries, remove = []) =>
      locked(async () => {
        const data = await read(c);
        for (const id of remove) delete data[id];
        await write(c, { ...data, ...entries });
      }),
    clear: (c) => locked(() => write(c, {})),
  };
}

export const db: Backend =
  REDIS_URL && REDIS_TOKEN
    ? redisBackend(REDIS_URL, REDIS_TOKEN)
    : fileBackend(process.env.DATA_DIR || path.join(process.cwd(), "data")); // DATA_DIR lets a test server use separate data

export const usingRedis = !!(REDIS_URL && REDIS_TOKEN);
