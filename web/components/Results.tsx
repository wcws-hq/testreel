import { motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { MAX_FULL_SECONDS, MAX_SHORT_SECONDS, type FinalMeta, type RunDetail, type VideoKind } from "../../src/shared/types.ts";
import { api, fileUrl } from "../api.ts";
import { clock } from "../lib/format.ts";
import { CopyButton, EASE_OUT, Section } from "./common.tsx";
import { Icon } from "./Icon.tsx";

const KINDS: { kind: VideoKind; label: string; limit: number }[] = [
  { kind: "full", label: "Long video", limit: MAX_FULL_SECONDS },
  { kind: "short", label: "Short", limit: MAX_SHORT_SECONDS },
];

function DurationMeter({ seconds, limit }: { seconds: number; limit: number }) {
  const ratio = seconds / limit;
  const tone = ratio > 1 ? "over" : ratio > 0.97 ? "near" : "ok";
  return (
    <div className={`meter meter-${tone}`}>
      <div className="meter-head">
        <span className="tnum meter-value">{clock(seconds)}</span>
        <span className="muted tnum">limit {clock(limit)}</span>
      </div>
      <div className="meter-track" role="img" aria-label={`${clock(seconds)} of ${clock(limit)}`}>
        <motion.span className="meter-fill" initial={{ width: 0 }} animate={{ width: `${Math.min(100, ratio * 100)}%` }} transition={{ duration: 1.1, delay: 0.3, ease: EASE_OUT }} />
        <span className="meter-limit" />
      </div>
    </div>
  );
}

interface PlayerProps {
  runId: string;
  kind: VideoKind;
  label: string;
  limit: number;
  video: string;
  poster: string | undefined;
  meta: FinalMeta | undefined;
}

function Player({ runId, kind, label, limit, video, poster, meta }: PlayerProps) {
  const src = fileUrl(runId, video);
  return (
    <div className={`player player-${kind}`}>
      <div className="player-head">
        <h3 className="mini-title">{label}</h3>
        <a className="btn btn-ghost btn-sm" href={fileUrl(runId, video, true)} download>
          <Icon name="download" size={13} /> MP4
        </a>
      </div>
      <div className={`frame frame-${kind}`}>
        {kind === "short" ? <span className="phone-speaker" aria-hidden="true" /> : null}
        <video controls playsInline preload="metadata" poster={poster ? fileUrl(runId, poster) : undefined} src={src} />
      </div>
      {meta ? <DurationMeter seconds={meta.durationSec} limit={limit} /> : null}
    </div>
  );
}

function ThumbPicker({ runId, kind, meta, thumbs, onMeta }: { runId: string; kind: VideoKind; meta: FinalMeta; thumbs: string[]; onMeta: (m: FinalMeta) => void }) {
  const [error, setError] = useState<string | null>(null);
  const choose = async (index: number): Promise<void> => {
    if (index === meta.thumbnail) return;
    setError(null);
    const previous = meta;
    onMeta({ ...meta, thumbnail: index });
    try {
      onMeta(await api.chooseThumbnail(runId, kind, index));
    } catch (e) {
      onMeta(previous);
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="block">
      <h3 className="mini-title">Thumbnail</h3>
      <ul className={`thumbs thumbs-${kind}`} role="radiogroup" aria-label="Thumbnail">
        {thumbs.map((path, i) => {
          const selected = meta.thumbnail === i + 1;
          return (
            <li key={path}>
              <button type="button" role="radio" aria-checked={selected} className={`thumb ${selected ? "is-selected" : ""}`} onClick={() => void choose(i + 1)}>
                <img src={fileUrl(runId, path)} alt={`Thumbnail option ${i + 1}`} loading="lazy" />
                {selected ? (
                  <motion.span className="thumb-badge" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 400, damping: 22 }}>
                    <Icon name="check" size={12} strokeWidth={2.6} /> Selected
                  </motion.span>
                ) : null}
              </button>
              <a className="thumb-dl" href={fileUrl(runId, path, true)} download aria-label={`Download thumbnail ${i + 1}`}>
                <Icon name="download" size={12} /> {i + 1}
              </a>
            </li>
          );
        })}
      </ul>
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}

function TitleOptions({ runId, kind, meta, onMeta }: { runId: string; kind: VideoKind; meta: FinalMeta; onMeta: (m: FinalMeta) => void }) {
  const [rows, setRows] = useState(() => (meta.titles.includes(meta.title) ? meta.titles : [...meta.titles, meta.title]));
  const [selected, setSelected] = useState(() => rows.indexOf(meta.title));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commit = async (index: number): Promise<void> => {
    const title = rows[index]?.trim();
    if (!title) return;
    setSelected(index);
    if (title === meta.title) return;
    setSaving(true);
    setError(null);
    try {
      onMeta(await api.setTitle(runId, kind, title));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="block">
      <h3 className="mini-title">Title</h3>
      <ul className="titles" role="radiogroup" aria-label="Title options">
        {rows.map((text, i) => (
          <li key={i} className={`title-row ${selected === i ? "is-selected" : ""}`}>
            <button type="button" role="radio" aria-checked={selected === i} aria-label={`Use title option ${i + 1}`} className="radio" onClick={() => void commit(i)} />
            <input
              type="text"
              value={text}
              maxLength={100}
              aria-label={`Title option ${i + 1}`}
              onChange={e => setRows(r => r.map((t, k) => (k === i ? e.target.value : t)))}
              onBlur={() => selected === i && void commit(i)}
              onKeyDown={e => e.key === "Enter" && void commit(i)}
            />
            <span className={`title-count tnum ${text.length > 70 ? "is-long" : ""}`}>{text.length}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">{saving ? "Saving" : "Pick one or edit it. Titles over 70 characters can get cut off in search."}</p>
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}

function CopyBlock({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className="block">
      <div className="block-head">
        <h3 className="mini-title">{title}</h3>
        <CopyButton text={text} />
      </div>
      {children ?? <p className="prose">{text}</p>}
    </div>
  );
}

function MetaPanel({ detail, kind, onMeta }: { detail: RunDetail; kind: VideoKind; onMeta: (kind: VideoKind, m: FinalMeta) => void }) {
  const meta = detail.meta[kind];
  const thumbs = detail.files.thumbs[kind] ?? [];
  if (!meta) return <p className="muted">Titles, description and tags appear once packaging has finished.</p>;
  const runId = detail.run.id;
  const chapters = meta.chapters.map(c => `${clock(c.t)} ${c.title}`).join("\n");
  return (
    <motion.div key={kind} className="meta-grid" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE_OUT }}>
      <div className="meta-col">
        {thumbs.length > 0 ? <ThumbPicker key={`thumb-${runId}-${kind}`} runId={runId} kind={kind} meta={meta} thumbs={thumbs} onMeta={m => onMeta(kind, m)} /> : null}
        <TitleOptions key={`title-${runId}-${kind}`} runId={runId} kind={kind} meta={meta} onMeta={m => onMeta(kind, m)} />
        <CopyBlock title="Pinned comment" text={meta.pinnedComment} />
      </div>
      <div className="meta-col">
        <CopyBlock title="Description" text={meta.description}>
          <pre className="prose prose-pre">{meta.description}</pre>
        </CopyBlock>
        <CopyBlock title="Tags" text={meta.tags.join(", ")}>
          <ul className="tags">
            {meta.tags.map(t => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </CopyBlock>
        <CopyBlock title="Hashtags" text={meta.hashtags.join(" ")}>
          <ul className="tags tags-hash">
            {meta.hashtags.map(t => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </CopyBlock>
        {meta.chapters.length > 0 ? (
          <CopyBlock title="Chapters" text={chapters}>
            <ol className="chapters">
              {meta.chapters.map(c => (
                <li key={`${c.t}-${c.title}`}>
                  <span className="tnum chapter-t">{clock(c.t)}</span>
                  {c.title}
                </li>
              ))}
            </ol>
          </CopyBlock>
        ) : null}
      </div>
    </motion.div>
  );
}

export function Results({ detail, onMeta }: { detail: RunDetail; onMeta: (kind: VideoKind, m: FinalMeta) => void }) {
  const [kind, setKind] = useState<VideoKind>("full");
  const present = KINDS.flatMap(k => {
    const video = detail.files.video[k.kind];
    return video ? [{ ...k, video }] : [];
  });
  if (present.length === 0) return null;
  const active = present.some(k => k.kind === kind) ? kind : (present[0]?.kind ?? "full");
  return (
    <Section title="Results">
      <div className="players">
        {present.map(k => {
          const meta = detail.meta[k.kind];
          const thumbs = detail.files.thumbs[k.kind];
          return (
            <Player
              key={k.kind}
              runId={detail.run.id}
              kind={k.kind}
              label={k.label}
              limit={k.limit}
              video={k.video}
              poster={meta ? thumbs?.[meta.thumbnail - 1] : thumbs?.[0]}
              meta={meta}
            />
          );
        })}
      </div>

      <div className="meta-switch">
        <h3 className="mini-title">Publishing details for</h3>
        <div className="seg seg-sm" role="tablist" aria-label="Video">
          {present.map(k => (
            <button key={k.kind} type="button" role="tab" aria-selected={active === k.kind} className={`seg-item ${active === k.kind ? "is-on" : ""}`} onClick={() => setKind(k.kind)}>
              {active === k.kind ? <motion.span layoutId="meta-seg" className="seg-thumb" transition={{ type: "spring", stiffness: 420, damping: 36 }} /> : null}
              <span className="seg-label">{k.label}</span>
            </button>
          ))}
        </div>
      </div>
      <MetaPanel detail={detail} kind={active} onMeta={onMeta} />
    </Section>
  );
}
