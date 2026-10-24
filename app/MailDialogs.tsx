"use client";

import { useEffect, useRef, useState } from "react";
import type { Post } from "@/lib/store";
import { buildSubject, EXPERIENCE_LEVELS, matchingSkills, type Draft, type ExperienceLevel } from "@/lib/mail";

type Target = { post: Post; email: string };

async function mailApi(body: Record<string, unknown>) {
  const res = await fetch("/api/mail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
  return data;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function ComposeDialog({
  target,
  alreadySentAt,
  onClose,
  onSent,
}: {
  target: Target;
  alreadySentAt?: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const { post, email } = target;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const edited = useRef(false);
  const subjectEdited = useRef(false);

  // First load: auto-generated draft + preview
  useEffect(() => {
    mailApi({ action: "preview", postId: post.id, email })
      .then((d) => {
        setDraft(d.draft);
        setHtml(d.html);
      })
      .catch(async (e) => {
        setError(e.message);
        // Preview failed: still show the draft so the subject can be reviewed
        const d = await mailApi({ action: "draft", postId: post.id, email }).catch(() => null);
        if (d) setDraft(d.draft);
      });
  }, [post.id, email]);

  // Refresh the preview after edits
  useEffect(() => {
    if (!draft || !edited.current) return;
    const t = setTimeout(() => {
      mailApi({ action: "preview", postId: post.id, ...draft })
        .then((d) => {
          setHtml(d.html);
          setError("");
        })
        .catch((e) => setError(e.message));
    }, 500);
    return () => clearTimeout(t);
  }, [draft, post.id]);

  const update = (patch: Partial<Draft>) => {
    edited.current = true;
    if ("subject" in patch) subjectEdited.current = true;
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, ...patch };
      // Keep the generated subject in step with role/company/resume until it's typed over
      if (!subjectEdited.current && !("subject" in patch)) {
        next.subject = buildSubject(post, next.experienceLevel, { role: next.role, company: next.company });
      }
      return next;
    });
  };

  const send = async () => {
    if (!draft) return;
    setSending(true);
    setError("");
    try {
      await mailApi({ action: "send", postId: post.id, ...draft, force: !!alreadySentAt });
      onSent();
    } catch (e) {
      setError((e as Error).message);
      setSending(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Send application</h2>
        {alreadySentAt && (
          <p className="warn">Already sent to {email} on {new Date(alreadySentAt).toLocaleString()}. Sending again will email them twice.</p>
        )}
        {!draft && !error && <p className="muted">Preparing email…</p>}
        {draft?.experienceAsked && (
          <p className="muted small">Post asks for {draft.experienceAsked} experience.</p>
        )}
        {draft && (
          <div className="form">
            <label>To<input value={email} readOnly /></label>
            <label>Subject<input value={draft.subject} onChange={(e) => update({ subject: e.target.value })} /></label>
            <div className="form-row">
              <label>Role<input value={draft.role} onChange={(e) => update({ role: e.target.value })} /></label>
              <label>Company<input value={draft.company} placeholder="your company" onChange={(e) => update({ company: e.target.value })} /></label>
              <label>
                Resume
                <select
                  value={draft.experienceLevel}
                  onChange={(e) => update({ experienceLevel: e.target.value as ExperienceLevel })}
                >
                  {Object.entries(EXPERIENCE_LEVELS).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        {html && <iframe className="preview" srcDoc={html} sandbox="" title="Email preview" />}
        <div className="dialog-actions">
          <button className="button" onClick={onClose}>Cancel</button>
          <button className="button primary" onClick={send} disabled={!draft || sending}>
            {sending ? "Sending…" : alreadySentAt ? "Send again" : "Send with resume"}
          </button>
        </div>
      </div>
    </div>
  );
}

type Row = Target & { draft?: Draft; include: boolean; state: "" | "sending" | "sent" | "failed"; error?: string };

export function BulkDialog({ targets, onClose, onDone }: { targets: Target[]; onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<Row[]>(targets.map((t) => ({ ...t, include: true, state: "" })));
  const [running, setRunning] = useState(false);
  const stop = useRef(false);

  // Generate each subject up front so they can be reviewed before sending
  useEffect(() => {
    targets.forEach((t, i) =>
      mailApi({ action: "draft", postId: t.post.id, email: t.email })
        .then((d) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, draft: d.draft } : r))))
        .catch(() => {})
    );
  }, [targets]);

  const patch = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  const start = async () => {
    setRunning(true);
    stop.current = false;
    let first = true;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (stop.current) break;
      if (!r.include || r.state === "sent") continue;
      if (!first) await sleep(2000); // same pacing as the mail sender's bulk mode, to avoid Gmail blocking
      first = false;
      patch(i, { state: "sending", error: undefined });
      try {
        await mailApi({ action: "send", postId: r.post.id, email: r.email, ...(r.draft ?? {}) });
        patch(i, { state: "sent" });
      } catch (e) {
        patch(i, { state: "failed", error: (e as Error).message });
        if (/not set up|Invalid login|auth/i.test((e as Error).message)) break; // Gmail problem: stop
      }
    }
    setRunning(false);
    onDone();
  };

  const included = rows.filter((r) => r.include && r.state !== "sent").length;
  const sent = rows.filter((r) => r.state === "sent").length;

  return (
    <div className="overlay" onClick={running ? undefined : onClose}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
        <h2>Send to {targets.length} HR emails</h2>
        <p className="muted small">
          Each email gets your template, personalised with the post&apos;s role, company and matching skills, plus the
          resume picked from the experience the post asks for. Untick anyone you don&apos;t want to email.
        </p>
        <div className="bulk-list">
          <table>
            <thead>
              <tr><th /><th>Email</th><th>Subject</th><th>Post asks</th><th>Your skills match</th><th>Resume</th><th>Status</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.email}>
                  <td>
                    <input type="checkbox" checked={r.include} disabled={running || r.state === "sent"} onChange={(e) => patch(i, { include: e.target.checked })} />
                  </td>
                  <td>
                    {r.email}
                    <div className="muted small">{r.post.author}</div>
                  </td>
                  <td className="small">{r.draft?.subject ?? "…"}</td>
                  <td className="small">{r.draft?.experienceAsked || "—"}</td>
                  <td className="small">
                    {(() => {
                      const m = matchingSkills(r.post.technologies);
                      return m.length ? m.join(", ") : <span className="error">none</span>;
                    })()}
                  </td>
                  <td className="small">{r.draft ? EXPERIENCE_LEVELS[r.draft.experienceLevel].label : ""}</td>
                  <td className="small">
                    {r.state === "sending" && "Sending…"}
                    {r.state === "sent" && "✅ Sent"}
                    {r.state === "failed" && <span className="error">❌ {r.error}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="dialog-actions">
          <span className="muted small">{running ? `Sent ${sent}…` : sent ? `Sent ${sent}` : ""}</span>
          {running ? (
            <button className="button danger" onClick={() => (stop.current = true)}>Stop</button>
          ) : (
            <>
              <button className="button" onClick={onClose}>Close</button>
              <button className="button primary" onClick={start} disabled={!included}>
                Send {included} emails
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
