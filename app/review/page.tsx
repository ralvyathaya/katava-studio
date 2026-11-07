"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientReview, HumanDecision } from "@/lib/approval-types";

export default function ClientPortal() {
  const credential = useRef("");
  const [review, setReview] = useState<ClientReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");
  const [choice, setChoice] = useState<HumanDecision | "">("");
  const [now, setNow] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!credential.current) { setError("No review credential. Open the full review link supplied by the manager; refreshing after its fragment is cleared requires reopening that original link."); return; }
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/review/session", { method: "POST", headers: { "Content-Type": "application/json" },
        cache: "no-store", referrerPolicy: "no-referrer", signal,
        body: JSON.stringify({ token: credential.current }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Review unavailable.");
      if (!signal?.aborted) { setReview(data as ClientReview); setNow(Date.now()); }
    } catch (e) { if (!signal?.aborted) { setReview(null); setError(e instanceof Error ? e.message : "Connection unavailable."); } }
    finally { if (!signal?.aborted) setBusy(false); }
  }, []);
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    if (token) credential.current = token;
    // The fragment was never sent to the server. Clear it before any API request;
    // keep it in memory only, not cookies/localStorage/sessionStorage or DOM.
    window.history.replaceState(null, "", window.location.pathname);
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [refresh]);
  const expired = review ? now >= Date.parse(review.expiresAt) : true;
  const submit = async () => {
    if (!review || !choice || busy || expired || !review.canDecide) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/review/decision", { method: "POST", headers: { "Content-Type": "application/json" },
        referrerPolicy: "no-referrer", body: JSON.stringify({ token: credential.current,
          contentVersionId: review.contentVersionId, decision: choice, comment }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Decision could not be saved.");
      setReview(current => current ? { ...current, decision: result.approval, canDecide: false } : current);
      setNotice("Your explicit decision is saved for this version. Nothing has been published.");
      setChoice("");
    } catch (e) {
      setError(`${e instanceof Error ? e.message : "Connection interrupted."} No new approval is inferred. Refresh the review to confirm the persisted state before retrying.`);
      setChoice("");
    } finally { setBusy(false); }
  };
  return <main className="min-h-screen bg-zinc-50 text-zinc-900 px-4 py-8">
    <div className="mx-auto max-w-3xl space-y-5">
      <header><p className="text-sm font-medium text-zinc-500">Katava Studio · Client Review</p>
        <h1 className="text-2xl font-semibold mt-1">Review an exact draft version</h1>
        <p className="mt-2 text-sm text-zinc-600">AI policy PASS is not human approval. You must make an explicit decision below. This portal never publishes content.</p></header>
      {busy && <p role="status" className="rounded-lg border bg-white p-4 text-sm">Loading or saving review…</p>}
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {notice && <p role="status" className="rounded-lg bg-green-50 border border-green-200 text-green-800 p-4 text-sm">{notice}</p>}
      {review && <>
        <section className="rounded-lg border border-zinc-200 bg-white p-5 space-y-3">
          <h2 className="text-lg font-semibold">{review.campaignName} · {review.format}</h2>
          <p className="text-xs font-mono break-all">Version {review.versionNumber} · {review.contentVersionId}</p>
          <p className="text-xs text-zinc-600">Link expires: {new Date(review.expiresAt).toLocaleString()}{expired && " · EXPIRED: no decisions accepted"}</p>
          <div className="rounded border border-zinc-200 bg-zinc-50 p-4 text-sm whitespace-pre-wrap break-words">{review.draftText}</div>
          <p className="text-xs text-zinc-600">Policy: {review.policy.rulebookId} v{review.policy.version} · reviewed {new Date(review.policy.reviewedAt).toLocaleString()}</p>
          <p className="text-xs text-zinc-600">{review.policy.authority}</p>
        </section>
        <section className="rounded-lg border border-zinc-200 bg-white p-5 space-y-3">
          <h2 className="font-semibold">Cited product-sheet evidence</h2>
          <p className="text-sm text-zinc-600">Source-backed means supported by the supplied sheet, not independently verified.</p>
          {review.citations.map(f => <blockquote key={f.id} className="border-l-2 border-zinc-300 pl-3 text-sm space-y-1">
            <p>{f.statement}</p><p className="text-xs text-zinc-600 whitespace-pre-wrap break-words">{f.sourceExcerpt}</p>
            <p className="font-mono text-xs text-zinc-500 break-all">{f.id} · {f.status}</p>
          </blockquote>)}
          {review.findings.map((f, i) => <div key={i} className="rounded bg-amber-50 p-3 text-sm text-amber-900">
            <strong>{f.ruleId} · {f.severity}</strong><p>{f.issue}</p><p>“{f.excerpt}”</p><p>{f.suggestedFix}</p><p className="text-xs">{f.ruleSource}</p>
          </div>)}
        </section>
        <section className="rounded-lg border border-zinc-200 bg-white p-5 space-y-4">
          <h2 className="font-semibold">Explicit human decision</h2>
          {review.decision ? <div role="status" className="rounded bg-zinc-50 p-4 text-sm space-y-2">
            <p className="font-semibold">Recorded: {review.decision.status.replace(/_/g, " ")}</p>
            <p>{review.decision.comment}</p><p className="text-xs">{new Date(review.decision.createdAt).toLocaleString()} · {review.decision.approvedBy} (bearer-link holder, not verified personal identity)</p>
            <p>This link is consumed. The decision cannot be changed or replayed; edits require a new policy-reviewed version.</p>
          </div> : <>
            <label htmlFor="review-comment" className="block text-sm font-medium">Feedback (required for rejection or changes)</label>
            <textarea id="review-comment" value={comment} onChange={e => setComment(e.target.value)} maxLength={2000}
              disabled={busy || expired} rows={4} className="w-full rounded border border-zinc-300 p-3 text-sm" />
            <fieldset disabled={busy || expired || !review.canDecide} className="flex flex-wrap gap-2 disabled:opacity-50">
              <button onClick={() => setChoice("approved")} className="rounded bg-green-700 text-white px-4 py-2 text-sm">Approve this version</button>
              <button onClick={() => setChoice("revision_requested")} disabled={!comment.trim()} className="rounded border border-amber-300 bg-amber-50 text-amber-900 px-4 py-2 text-sm">Request changes</button>
              <button onClick={() => setChoice("rejected")} disabled={!comment.trim()} className="rounded border border-red-200 bg-red-50 text-red-800 px-4 py-2 text-sm">Reject this version</button>
            </fieldset>
            {choice && <div className="rounded border border-zinc-300 bg-zinc-50 p-4 text-sm space-y-3">
              <p>Confirm <strong>{choice.replace(/_/g, " ")}</strong> for version {review.versionNumber} only? This is a final decision, not publication.</p>
              <div className="flex gap-3"><button onClick={() => void submit()} disabled={busy || expired} className="rounded bg-zinc-900 text-white px-4 py-2 disabled:opacity-50">Confirm decision</button>
                <button onClick={() => setChoice("")} className="rounded border px-4 py-2">Cancel</button></div>
            </div>}
          </>}
          <p className="text-xs text-zinc-600">{review.disclaimer}</p>
        </section>
      </>}
      <button onClick={() => void refresh()} disabled={busy} className="rounded border border-zinc-300 bg-white px-4 py-2 text-sm disabled:opacity-50">Refresh persisted review</button>
      <p className="text-xs text-zinc-500">Do not forward this private bearer link to unintended recipients. No account login or external identity verification is implied.</p>
    </div>
  </main>;
}
