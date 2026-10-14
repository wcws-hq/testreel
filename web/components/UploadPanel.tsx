import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { RunDetail, UploadRecord, VideoKind } from "../../src/shared/types.ts";
import { api } from "../api.ts";
import { useHealth, useYoutube, type YoutubeState } from "../hooks/useData.ts";
import { toLocalInputValue } from "../lib/format.ts";
import { Icon } from "./Icon.tsx";
import { LiveDot, Section, Spinner } from "./common.tsx";

const PRIVACY: { value: UploadRecord["privacy"]; label: string }[] = [
  { value: "private", label: "Private" },
  { value: "unlisted", label: "Unlisted" },
  { value: "public", label: "Public" },
];

const KIND_LABEL: Record<VideoKind, string> = { full: "Long video", short: "Short" };

interface RowProps {
  runId: string;
  kind: VideoKind;
  title: string;
  record: UploadRecord | undefined;
  canUpload: boolean;
  autoPending: boolean;
  onUploaded: (record: UploadRecord) => void;
}

function UploadRow({ runId, kind, title, record, canUpload, autoPending, onUploaded }: RowProps) {
  const [privacy, setPrivacy] = useState<UploadRecord["privacy"]>("private");
  const [scheduled, setScheduled] = useState(false);
  const [publishAt, setPublishAt] = useState(() => toLocalInputValue(new Date(Date.now() + 24 * 3600 * 1000)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      onUploaded(await api.upload(runId, kind, scheduled ? "private" : privacy, scheduled ? new Date(publishAt).toISOString() : undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="upload-row">
      <div className="upload-head">
        <div>
          <h3 className="mini-title">{KIND_LABEL[kind]}</h3>
          <p className="upload-title">{title}</p>
        </div>
        {record ? (
          <span className="pill pill-ok">
            <Icon name="check" size={12} strokeWidth={2.6} /> Uploaded
          </span>
        ) : null}
      </div>

      {record ? (
        <div className="upload-done">
          <a className="btn btn-sm" href={record.url} target="_blank" rel="noreferrer">
            Open on YouTube <Icon name="external" size={13} />
          </a>
          <span className="muted small">
            {record.privacy}
            {record.publishAt ? `, goes public ${new Date(record.publishAt).toLocaleString()}` : ""}
          </span>
        </div>
      ) : autoPending ? (
        <p className="upload-auto">
          <LiveDot /> Automatic upload in progress
        </p>
      ) : (
        <div className="upload-controls">
          <div className="seg seg-sm" role="radiogroup" aria-label={`${KIND_LABEL[kind]} privacy`}>
            {PRIVACY.map(p => {
              const on = (scheduled ? "private" : privacy) === p.value;
              return (
                <button key={p.value} type="button" role="radio" aria-checked={on} disabled={scheduled} className={`seg-item ${on ? "is-on" : ""}`} onClick={() => setPrivacy(p.value)}>
                  {on ? <motion.span layoutId={`privacy-${kind}`} className="seg-thumb" transition={{ type: "spring", stiffness: 420, damping: 36 }} /> : null}
                  <span className="seg-label">{p.label}</span>
                </button>
              );
            })}
          </div>
          <label className="check">
            <input type="checkbox" checked={scheduled} onChange={e => setScheduled(e.target.checked)} />
            <span className="check-box">
              <Icon name="check" size={11} strokeWidth={3} />
            </span>
            Schedule publish
          </label>
          <AnimatePresence initial={false}>
            {scheduled ? (
              <motion.div key="when" className="schedule" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                <input type="datetime-local" value={publishAt} min={toLocalInputValue(new Date())} onChange={e => setPublishAt(e.target.value)} aria-label="Publish time" />
                <span className="muted small">Stays private until this time.</span>
              </motion.div>
            ) : null}
          </AnimatePresence>
          <button type="button" className="btn btn-primary" disabled={!canUpload || busy || (scheduled && !publishAt)} onClick={() => void upload()}>
            {busy ? <Spinner /> : <Icon name="upload" size={15} />}
            {busy ? "Uploading" : scheduled ? "Upload and schedule" : "Upload"}
          </button>
          {busy ? (
            <div className="indeterminate" role="progressbar" aria-label="Uploading">
              <span />
            </div>
          ) : null}
        </div>
      )}
      {error ? <p className="field-error">{error}</p> : null}
    </li>
  );
}

export function UploadPanel({ detail, onUploaded }: { detail: RunDetail; onUploaded: (record: UploadRecord) => void }) {
  const yt = useYoutube();
  const { health } = useHealth();
  const kinds = (["full", "short"] as const).filter(k => detail.meta[k]);
  if (kinds.length === 0) return null;
  const connected = yt.status?.connected === true;
  const configured = yt.status?.configured !== false;
  const settingsDir = health?.settingsDir ?? "the settings folder";

  return (
    <Section title="Upload to YouTube" aside={yt.status ? <ConnectionState yt={yt} configured={configured} connected={connected} /> : null}>
      {yt.status && !configured ? (
        <div className="notice notice-warn">
          <Icon name="alert" size={16} />
          <span>
            YouTube is not set up on this machine. Add YT_CLIENT_ID and YT_CLIENT_SECRET to the .env file in {settingsDir}, restart Testreel, then come back here to connect your channel. Everything above still works without it, and you can download the files.
          </span>
        </div>
      ) : null}
      {yt.status && configured && !connected ? (
        <p className="muted small upload-hint">Connect your channel to enable uploads. Sign-in opens in a new tab.</p>
      ) : null}
      {yt.error ? <p className="field-error">{yt.error}</p> : null}
      <ul className="uploads">
        {kinds.map(kind => (
          <UploadRow
            key={kind}
            runId={detail.run.id}
            kind={kind}
            title={detail.meta[kind]?.title ?? ""}
            record={detail.uploads.find(u => u.kind === kind)}
            canUpload={connected}
            autoPending={detail.run.autoUpload && detail.run.status === "running"}
            onUploaded={onUploaded}
          />
        ))}
      </ul>
    </Section>
  );
}

function ConnectionState({ yt, configured, connected }: { yt: YoutubeState; configured: boolean; connected: boolean }) {
  if (!configured) return <span className="pill pill-warn">Not configured</span>;
  if (connected) {
    return (
      <div className="yt-state">
        <span className="pill pill-ok">
          <span className="status-dot" /> {yt.status?.channelTitle ?? "Connected"}
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void yt.disconnect()} disabled={yt.busy}>
          Disconnect
        </button>
      </div>
    );
  }
  return (
    <button type="button" className="btn btn-sm" onClick={() => void yt.connect()} disabled={yt.busy || yt.waiting}>
      {yt.waiting ? <Spinner size={12} /> : null}
      {yt.waiting ? "Waiting for sign-in" : "Connect YouTube"}
    </button>
  );
}
