"use client";
import { useEffect, useRef, useState } from "react";
import type { ApprovalOverview } from "@/lib/approval-types";
import { DownloadIcon, ShieldCheckIcon } from "./ui-icons";

export function ApprovalControls({ contentItemId, managerKey, draftText, onChanged }: {
  contentItemId: string; managerKey: string; draftText: string; onChanged: () => void;
}) {
  const [overview, setOverview] = useState<ApprovalOverview | null>(null);
  const [hours, setHours] = useState(24);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState(draftText);
  const [acknowledged, setAcknowledged] = useState(false);
  const [exportFormat, setExportFormat] = useState<"markdown" | "json" | "text">("markdown");
  const [exporting, setExporting] = useState(false);
  const inFlight = useRef<AbortController | null>(null);
  // Parent remounts on item/credential epoch changes, without putting a secret in
  // the React key. Unmount aborts old requests and discards all private state.
  useEffect(() => () => { inFlight.current?.abort(); }, []);
  const request = async (body: Record<string, unknown>, signal: AbortSignal) => {
    const response = await fetch(`/api/approvals/${encodeURIComponent(contentItemId)}`, {
      method: "POST", cache: "no-store", signal,
      headers: { "Content-Type": "application/json", "X-Katava-Manager-Key": managerKey.trim() },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message ?? `HTTP ${response.status}`);
    return data;
  };
  const act = async (body: Record<string, unknown>) => {
    if (busy || !managerKey.trim()) return;
    inFlight.current?.abort();
    const controller = new AbortController(); inFlight.current = controller;
    if (body.action === "overview") { setEditing(false); setAcknowledged(false); }
    setBusy(true); setError(null); setNotice(null);
    try {
      const data = await request(body, controller.signal);
      if (controller.signal.aborted) return;
      if (body.action === "overview") {
        setOverview(data as ApprovalOverview);
        // The client may have decided in another tab. Refresh parent audit/status too.
        onChanged();
      } else {
        // A mutation has now been acknowledged. Invalidate the old approval snapshot
        // immediately, even if the follow-up read fails. Do not lose a confirmed URL.
        setOverview(null); setEditing(false); setAcknowledged(false);
        if (body.action === "issue") {
          setUrl(`${window.location.origin}/review#token=${data.token}`);
          setNotice("Private bearer link issued for this version. It is shown once here; do not forward to unintended recipients. AI PASS is still not human approval.");
        } else {
          setUrl(null);
          setNotice(body.action === "edit" ? data.message : "Review link revoked. No human decision was overwritten.");
        }
        onChanged();
        try {
          const current = await request({ action: "overview" }, controller.signal);
          if (!controller.signal.aborted) setOverview(current);
        } catch {
          if (!controller.signal.aborted) setError("The operation was saved, but the follow-up overview could not be loaded. Refresh approval state; do not repeat the saved operation. Any newly issued private URL is retained below.");
        }
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        setOverview(null);
        setError(`${e instanceof Error ? e.message : "Connection interrupted."} Refresh persisted approval state before retrying; no success is inferred.`);
        if (body.action !== "overview") { setUrl(null); onChanged(); }
      }
    } finally { if (!controller.signal.aborted) setBusy(false); }
  };
  const doExport = async (format: "markdown" | "json" | "text") => {
    if (exporting || !overview?.currentVersionId || !overview.currentApproval) return;
    setExporting(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/approvals/${encodeURIComponent(contentItemId)}`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Katava-Manager-Key": managerKey.trim() },
        body: JSON.stringify({ action: "export", contentVersionId: overview.currentVersionId, format }),
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
      setNotice(`Exported approved version as ${format}. Audit recorded. Nothing was published.`);
      onChanged();
    } catch (e) {
      setError(`${e instanceof Error ? e.message : "Export failed."} No export was produced.`);
    } finally { setExporting(false); }
  };
  return <section className="space-y-4 rounded-2xl border border-violet-200 bg-violet-50/45 p-5 text-sm text-zinc-800" aria-label="Human approval controls">
    <div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white"><ShieldCheckIcon className="h-5 w-5" /></span><div><h3 className="font-bold">Approve & export</h3><p className="mt-1 text-xs leading-5 text-zinc-600">Send this exact reviewed version for one final human decision. Approval unlocks download—never automatic publishing.</p></div></div>
    {!managerKey.trim() && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950">Open <strong>Manager access</strong> above and enter the separate manager credential to continue.</p>}
    <button disabled={busy || !managerKey.trim()} onClick={() => void act({ action: "overview" })}
      className="rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-violet-700 disabled:opacity-45">{busy ? "Checking persisted state…" : overview ? "Refresh approval state" : "Check approval state"}</button>
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-800 break-words">{error}</p>}
    {notice && <p role="status" className="rounded bg-blue-50 p-3 text-blue-900">{notice}</p>}
    {url && <div className="space-y-2">
      <label className="block text-xs font-medium">Private review URL (bearer credential)</label>
      <input readOnly value={url} aria-label="Private review URL" className="w-full rounded border border-zinc-300 bg-white p-2 text-xs font-mono" />
      <button onClick={() => void navigator.clipboard.writeText(url).then(() => setNotice("Review URL copied. Treat it as a private bearer credential."))
        .catch(() => setError("Clipboard unavailable. Select and copy the private URL manually."))} className="rounded border bg-white px-3 py-1 text-xs">Copy private link</button>
      <a href={url} target="_blank" rel="noopener noreferrer" className="ml-3 text-blue-700 underline text-xs">Open client preview</a>
    </div>}
    {overview && <>
      <p className="font-medium">Persisted state: {overview.status.replace(/_/g, " ")} · v{overview.versionNumber ?? "—"}</p>
      {overview.currentApproval ? <div className="rounded bg-green-50 border border-green-200 p-3 text-green-800">
        <strong>Human approved this exact version</strong><p className="text-xs">{overview.currentApproval.contentVersionId} · {new Date(overview.currentApproval.createdAt).toLocaleString()}</p>
        <p className="text-xs">{overview.currentApproval.approvedBy} · bearer-link holder; personal identity not independently verified. Not published.</p>
      </div> : <p className="text-xs">No current human approval. Historical approvals do not approve edited drafts.</p>}
      {!overview.eligible && <p className="text-xs text-amber-900">{overview.eligibilityReason}</p>}
      {overview.eligible && <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs">Expiry<select value={hours} onChange={e => setHours(Number(e.target.value))} disabled={busy}
          className="ml-2 rounded border bg-white p-2"><option value={1}>1 hour</option><option value={24}>24 hours</option><option value={72}>72 hours</option></select></label>
        <button disabled={busy} onClick={() => void act({ action: "issue", contentVersionId: overview.currentVersionId, expiresInHours: hours })}
          className="rounded bg-zinc-900 text-white px-3 py-2 disabled:opacity-50">Issue / replace review link</button>
      </div>}
      {overview.links.map(link => <div key={link.id} className="rounded border border-zinc-200 bg-white p-2 text-xs space-y-1">
        <p className="font-mono break-all">{link.id} · {link.state} · version {link.contentVersionId}</p>
        <p>Expires {new Date(link.expiresAt).toLocaleString()}</p>
        {link.state === "active" && <button disabled={busy} onClick={() => void act({ action: "revoke", linkId: link.id })}
          className="rounded border border-red-200 bg-red-50 text-red-800 px-2 py-1">Revoke this link</button>}
      </div>)}
      {overview.approvals.length > 0 && <details className="text-xs space-y-2"><summary className="cursor-pointer font-medium">Immutable decision history ({overview.approvals.length})</summary>
        {overview.approvals.map(a => <div key={a.id} className="border-t py-2 break-words"><p>{a.status} · {a.contentVersionId} · {new Date(a.createdAt).toLocaleString()}</p><p>{a.comment}</p></div>)}
      </details>}
      {overview.currentApproval && overview.currentVersionId && <div className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-bold text-emerald-950">Approved content is ready</p>
        <p className="text-xs leading-5 text-emerald-800">Download this exact approved version. Every export is recorded; nothing is sent to a platform.</p>
        <div className="flex flex-wrap items-center gap-2">
          <select value={exportFormat} onChange={e => setExportFormat(e.target.value as "markdown" | "json" | "text")} disabled={exporting}
            aria-label="Export file format" className="rounded-xl border border-emerald-300 bg-white px-3 py-2.5 text-xs">
            <option value="markdown">Markdown (.md)</option>
            <option value="json">JSON (.json)</option>
            <option value="text">Plain text (.txt)</option>
          </select>
          <button disabled={exporting} onClick={() => void doExport(exportFormat)}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50"><DownloadIcon className="h-4 w-4" />{exporting ? "Preparing file…" : "Download approved file"}</button>
        </div>
      </div>}
      {overview.currentVersionId && <>
        <button onClick={() => { setEditing(!editing); setEdit(overview.draftText ?? draftText); }} disabled={busy} className="text-xs text-amber-900 underline">{editing ? "Cancel editing" : "Edit draft as a new unreviewed version"}</button>
        {editing && <div className="rounded border border-amber-300 bg-amber-50 p-3 space-y-3">
          <p className="text-xs text-amber-900">Editing invalidates current approval eligibility and revokes review links. Prior drafts/decisions stay in history. This does not run a new AI review.</p>
          <textarea aria-label="Edited draft" value={edit} onChange={e => setEdit(e.target.value)} rows={8} maxLength={20000} className="w-full rounded border bg-white p-2 text-sm" />
          <label className="flex gap-2 text-xs"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />I understand this new version is unreviewed and cannot be approved or published.</label>
          <button disabled={busy || !acknowledged || edit.trim().length < 10} onClick={() => void act({ action: "edit", contentVersionId: overview.currentVersionId, draftText: edit })}
            className="rounded bg-amber-800 text-white px-3 py-2 text-xs disabled:opacity-50">Save unreviewed version</button>
        </div>}
      </>}
    </>}
  </section>;
}
