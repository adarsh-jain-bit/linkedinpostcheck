"use client";

import { useCallback, useEffect, useState } from "react";
import type { Post, SentRecord } from "@/lib/store";
import { formatExperience } from "@/lib/extract";
import { BulkDialog, ComposeDialog } from "./MailDialogs";

export default function Home() {
  const [query, setQuery] = useState("");
  const [withEmail, setWithEmail] = useState(false);
  // Experience filter: blank = off. Posts whose asked range overlaps min–max are shown.
  const [expMin, setExpMin] = useState("");
  const [expMax, setExpMax] = useState("");
  const [includeNoExp, setIncludeNoExp] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState<Record<string, SentRecord>>({});
  const [compose, setCompose] = useState<{ post: Post; email: string } | null>(null);
  const [bulk, setBulk] = useState<{ post: Post; email: string }[] | null>(null);

  const params = new URLSearchParams({
    q: query,
    ...(withEmail ? { withEmail: "1" } : {}),
    ...(expMin ? { expMin } : {}),
    ...(expMax ? { expMax } : {}),
    ...((expMin || expMax) && includeNoExp ? { noExp: "1" } : {}),
  }).toString();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/posts?${params}`);
      const data = await res.json();
      setPosts(data.posts);
      setSent(data.sent ?? {});
    } finally {
      setLoading(false);
    }
  }, [params]);

  // Debounced live search
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const clearAll = async () => {
    if (!confirm("Delete all captured posts?")) return;
    await fetch("/api/posts", { method: "DELETE" });
    load();
  };

  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const emailCount = new Set(posts.flatMap((p) => p.emails)).size;

  // One target per unsent email among the shown posts (newest post wins)
  const unsent: { post: Post; email: string }[] = [];
  const seen = new Set<string>();
  for (const post of posts) {
    for (const email of post.emails) {
      if (seen.has(email) || sent[email]) continue;
      seen.add(email);
      unsent.push({ post, email });
    }
  }

  return (
    <main>
      <header>
        <h1>LinkedIn Post Checker</h1>
        <p className="muted">
          Capture posts with the browser extension, then search and export roles, emails, companies and technologies.
        </p>
      </header>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search keyword, e.g. react hiring"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <label className="check">
          <input type="checkbox" checked={withEmail} onChange={(e) => setWithEmail(e.target.checked)} />
          Only posts with emails
        </label>
        <div className="exp-filter">
          <span>Experience</span>
          <input type="number" min={0} max={30} step={0.5} placeholder="min" value={expMin} onChange={(e) => setExpMin(e.target.value)} />
          <span>–</span>
          <input type="number" min={0} max={30} step={0.5} placeholder="max" value={expMax} onChange={(e) => setExpMax(e.target.value)} />
          <span>yrs</span>
          {(expMin || expMax) && (
            <label className="check small">
              <input type="checkbox" checked={includeNoExp} onChange={(e) => setIncludeNoExp(e.target.checked)} />
              include posts that don&apos;t say
            </label>
          )}
        </div>
        <a className="button primary" href={`/api/export?${params}`}>
          Export to Excel
        </a>
        <button className="button primary" onClick={() => setBulk(unsent)} disabled={!unsent.length}>
          Email all unsent ({unsent.length})
        </button>
        <button className="button" onClick={load}>Refresh</button>
        <button className="button danger" onClick={clearAll}>Clear all</button>
      </div>

      <p className="muted">
        {loading
          ? "Loading…"
          : `${posts.length} posts · ${emailCount} unique emails · ${emailCount - unsent.length} already emailed`}
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Author</th>
              <th>Role</th>
              <th>Company</th>
              <th>Emails</th>
              <th>Technologies</th>
              <th>Post</th>
            </tr>
          </thead>
          <tbody>
            {posts.map((p) => (
              <tr key={p.id}>
                <td>
                  <strong>
                    {p.authorUrl ? (
                      <a href={p.authorUrl} target="_blank" rel="noreferrer">{p.author || "Profile"}</a>
                    ) : (
                      p.author || "—"
                    )}
                  </strong>
                  <div className="muted small">{p.authorHeadline}</div>
                  <div className="muted small">{p.postedAt}</div>
                </td>
                <td>
                  {p.roles.length ? p.roles.map((r) => <div key={r}>{r}</div>) : "—"}
                  {p.experience && <div className="exp-badge">{formatExperience(p.experience)}</div>}
                </td>
                <td>{p.companies.join(", ") || "—"}</td>
                <td>
                  {p.emails.length
                    ? p.emails.map((e) => (
                        <div key={e} className="email-row">
                          <a href={`mailto:${e}`}>{e}</a>
                          {sent[e] ? (
                            <button
                              className="sent-badge"
                              title={`Sent ${new Date(sent[e].sentAt).toLocaleString()}: ${sent[e].subject}`}
                              onClick={() => setCompose({ post: p, email: e })}
                            >
                              ✅ Sent {new Date(sent[e].sentAt).toLocaleDateString()}
                            </button>
                          ) : (
                            <button className="send-btn" onClick={() => setCompose({ post: p, email: e })}>
                              Send ✉
                            </button>
                          )}
                        </div>
                      ))
                    : "—"}
                </td>
                <td>
                  {p.technologies.map((t) => (
                    <span key={t} className="tag">{t}</span>
                  ))}
                </td>
                <td className="post">
                  <div className={expanded.has(p.id) ? "" : "clamp"}>{p.text}</div>
                  <button className="link" onClick={() => toggle(p.id)}>
                    {expanded.has(p.id) ? "Show less" : "Show more"}
                  </button>
                  {p.url && (
                    <a className="small" href={p.url} target="_blank" rel="noreferrer">
                      Open on LinkedIn ↗
                    </a>
                  )}
                </td>
              </tr>
            ))}
            {!loading && posts.length === 0 && (
              <tr>
                <td colSpan={6} className="muted empty">
                  No posts yet. Search on LinkedIn, then click “Capture posts” in the extension.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {compose && (
        <ComposeDialog
          target={compose}
          alreadySentAt={sent[compose.email]?.sentAt}
          onClose={() => setCompose(null)}
          onSent={() => {
            setCompose(null);
            load();
          }}
        />
      )}
      {bulk && <BulkDialog targets={bulk} onClose={() => { setBulk(null); load(); }} onDone={load} />}
    </main>
  );
}
