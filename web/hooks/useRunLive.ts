import { useCallback, useEffect, useRef, useState } from "react";
import type { FinalMeta, RunDetail, RunEvent, UploadRecord, VideoKind } from "../../src/shared/types.ts";
import { api, ApiError } from "../api.ts";
import { emptyLive, reduceEvent, type LiveState } from "../lib/liveState.ts";

export type Connection = "connecting" | "live" | "reconnecting";

const FLUSH_MS = 60;
const REFETCH_MS = 300;
const RECONNECT_MS = [1000, 2000, 4000, 8000];

export interface RunLive {
  detail: RunDetail | null;
  loadError: string | null;
  live: LiveState;
  connection: Connection;
  refresh: () => Promise<void>;
  patchMeta: (kind: VideoKind, meta: FinalMeta) => void;
  addUpload: (record: UploadRecord) => void;
}

export function useRunLive(id: string): RunLive {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveState>(emptyLive);
  const [connection, setConnection] = useState<Connection>("connecting");
  const refetchTimer = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      setDetail(await api.run(id));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError && e.status === 404 ? "This run does not exist." : e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    setDetail(null);
    setLoadError(null);
    setLive(emptyLive);
    setConnection("connecting");
    void refresh();

    let source: EventSource | null = null;
    let buffer: RunEvent[] = [];
    let flushTimer: number | undefined;
    let reconnectTimer: number | undefined;
    let attempt = 0;
    let disposed = false;

    const flush = (): void => {
      flushTimer = undefined;
      const batch = buffer;
      buffer = [];
      setLive(prev => batch.reduce(reduceEvent, prev));
      if (batch.some(e => e.kind === "artifact" || e.kind === "stage" || e.kind === "run")) {
        window.clearTimeout(refetchTimer.current);
        refetchTimer.current = window.setTimeout(() => void refresh(), REFETCH_MS);
      }
    };

    const open = (): void => {
      source = new EventSource(`/api/runs/${id}/events`);
      source.onopen = () => {
        attempt = 0;
        setConnection("live");
      };
      source.onmessage = message => {
        buffer.push(JSON.parse(message.data) as RunEvent);
        flushTimer ??= window.setTimeout(flush, FLUSH_MS);
      };
      source.onerror = () => {
        setConnection("reconnecting");
        if (source?.readyState !== EventSource.CLOSED || disposed) return;
        const delay = RECONNECT_MS[Math.min(attempt++, RECONNECT_MS.length - 1)] ?? 8000;
        reconnectTimer = window.setTimeout(open, delay);
      };
    };
    open();

    return () => {
      disposed = true;
      source?.close();
      window.clearTimeout(flushTimer);
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(refetchTimer.current);
    };
  }, [id, refresh]);

  const patchMeta = useCallback((kind: VideoKind, meta: FinalMeta) => {
    setDetail(d => (d ? { ...d, meta: { ...d.meta, [kind]: meta } } : d));
  }, []);

  const addUpload = useCallback((record: UploadRecord) => {
    setDetail(d => (d ? { ...d, uploads: [...d.uploads.filter(u => u.kind !== record.kind), record] } : d));
  }, []);

  return { detail, loadError, live, connection, refresh, patchMeta, addUpload };
}
