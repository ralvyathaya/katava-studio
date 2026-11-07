"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientReview, HumanDecision } from "@/lib/approval-types";
import { DownloadIcon, FormatIcon, KatavaMark, ShieldCheckIcon } from "../ui-icons";

export default function ClientPortal() {
  const credential = useRef("");
  const [review, setReview] = useState<ClientReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");
  const [choice, setChoice] = useState<HumanDecision | "">("");
  const [now, setNow] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<"markdown" | "json" | "text">("markdown");
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
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
  const doExport = async (format: "markdown" | "json" | "text") => {
    if (exporting || !review || !review.decision || review.decision.status !== "approved") return;
    setExporting(true); setExportNotice(null);
    try {
      const response = await fetch("/api/review/export", {
        method: "POST", headers: { "Content-Type": "application/json" },
        referrerPolicy: "no-referrer",
        body: JSON.stringify({ token: credential.current, contentVersionId: review.contentVersionId, format }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message ?? `HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? `katava-export.${format === "markdown" ? "md" : format}`;
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(objectUrl);
      setExportNotice("Downloaded approved content. Export is recorded in the audit trail. Nothing was published.");
    } catch (e) {
      setExportNotice(`${e instanceof Error ? e.message : "Export failed."} No export was produced.`);
    } finally { setExporting(false); }
  };
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
  return <main className="min-h-screen bg-[#f7f7fb] px-4 py-6 text-zinc-900 sm:py-10">
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <div className="mb-7 flex items-center gap-3"><KatavaMark className="h-10 w-10" /><div><p className="font-bold">Katava Studio</p><p className="text-xs text-zinc-500">Private client review</p></div></div>
        <div className="inline-flex items-center gap-2 rounded-full bg-violet-100 px-3 py-1.5 text-xs font-semibold text-violet-800"><ShieldCheckIcon className="h-4 w-4" /> EXACT-VERSION APPROVAL</div>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">Review. Decide. Export.</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600">Check the draft and its cited evidence, then make an explicit decision. Reading this page never approves content, and this portal never publishes it.</p>
      </header>
      {busy && <p role="status" className="rounded-lg border bg-white p-4 text-sm">Loading or saving review…</p>}
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {notice && <p role="status" className="rounded-lg bg-green-50 border border-green-200 text-green-800 p-4 text-sm">{notice}</p>}
      {review && <>
        <section className="space-y-4 rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-center gap-3"><FormatIcon format={review.format} className="h-12 w-12 shrink-0" /><div><h2 className="text-lg font-bold">{review.campaignName}</h2><p className="mt-0.5 text-xs capitalize text-zinc-500">{review.format} · version {review.versionNumber}</p></div></div>
          <div className={`rounded-xl px-3 py-2 text-xs ${expired ? "bg-red-50 text-red-800" : "bg-zinc-50 text-zinc-600"}`}>{expired ? "This review link has expired; no decisions are accepted." : `Review link expires ${new Date(review.expiresAt).toLocaleString()}`}</div>
          <div className="max-h-[36rem] overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-zinc-200 bg-zinc-50/70 p-5 text-sm leading-7">{review.draftText}</div>
          <details className="text-xs text-zinc-500"><summary>Version and policy evidence</summary><p className="mt-2 break-all font-mono">{review.contentVersionId}</p><p className="mt-2">Policy: {review.policy.rulebookId} v{review.policy.version} · reviewed {new Date(review.policy.reviewedAt).toLocaleString()}</p><p className="mt-1">{review.policy.authority}</p></details>
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
        {review.decision && review.decision.status === "approved" && <section className="space-y-3 rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
          <h2 className="font-bold text-emerald-950">Your approved file is ready</h2>
          <p className="text-sm leading-6 text-emerald-800">Download this exact approved version. Each export is recorded; nothing is published to any platform.</p>
          {exportNotice && <p role="status" className="rounded-xl border border-emerald-200 bg-white p-3 text-sm text-emerald-800">{exportNotice}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <select value={exportFormat} onChange={e => setExportFormat(e.target.value as "markdown" | "json" | "text")} disabled={exporting}
              aria-label="Export file format" className="rounded-xl border border-emerald-300 bg-white px-3 py-2.5 text-sm">
              <option value="markdown">Markdown (.md)</option>
              <option value="json">JSON (.json)</option>
              <option value="text">Plain text (.txt)</option>
            </select>
            <button disabled={exporting} onClick={() => void doExport(exportFormat)}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50"><DownloadIcon className="h-4 w-4" />{exporting ? "Preparing file…" : "Download approved file"}</button>
          </div>
        </section>}
      </>}
      <button onClick={() => void refresh()} disabled={busy} className="rounded border border-zinc-300 bg-white px-4 py-2 text-sm disabled:opacity-50">Refresh persisted review</button>
      <p className="text-xs text-zinc-500">Do not forward this private bearer link to unintended recipients. No account login or external identity verification is implied.</p>
    </div>
  </main>;
}
