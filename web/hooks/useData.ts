import { useCallback, useEffect, useRef, useState } from "react";
import type { Health, Run, RunDetail, YoutubeStatus } from "../../src/shared/types.ts";
import { api } from "../api.ts";

export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [active, intervalMs]);
  return now;
}

export function useHealth(): { health: Health | null; error: string | null; checking: boolean; recheck: () => void } {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const recheck = useCallback(() => {
    setChecking(true);
    api
      .health()
      .then(h => {
        setHealth(h);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setChecking(false));
  }, []);
  useEffect(recheck, [recheck]);
  return { health, error, checking, recheck };
}

const ACTIVE_POLL_MS = 3000;

export function useRuns(): { runs: Run[] | null; error: string | null; refresh: () => void } {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const refresh = useCallback(() => {
    window.clearTimeout(timer.current);
    api
      .runs()
      .then(list => {
        setRuns(list);
        setError(null);
        if (list.some(r => r.status === "running" || r.status === "queued")) timer.current = window.setTimeout(refresh, ACTIVE_POLL_MS);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      window.clearTimeout(timer.current);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  return { runs, error, refresh };
}

const finishedDetails = new Map<string, Promise<RunDetail>>();

// Finished runs never change shape, so card details are fetched once per page load.
export function useFinishedDetail(id: string, enabled: boolean): RunDetail | null {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let pending = finishedDetails.get(id);
    if (!pending) {
      pending = api.run(id);
      finishedDetails.set(id, pending);
      pending.catch(() => finishedDetails.delete(id));
    }
    pending.then(d => !cancelled && setDetail(d)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id, enabled]);
  return detail;
}

const CONNECT_POLL_MS = 2000;
const CONNECT_GIVE_UP_MS = 3 * 60_000;

export interface YoutubeState {
  status: YoutubeStatus | null;
  busy: boolean;
  waiting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

export function useYoutube(): YoutubeState {
  const [status, setStatus] = useState<YoutubeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    api
      .youtube()
      .then(setStatus)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => window.clearTimeout(pollTimer.current);
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    setBusy(true);
    const tab = window.open("", "_blank");
    try {
      const { url } = await api.youtubeConnect();
      if (tab) tab.location.href = url;
      else window.open(url, "_blank");
      setWaiting(true);
      const deadline = Date.now() + CONNECT_GIVE_UP_MS;
      const poll = async (): Promise<void> => {
        const next = await api.youtube();
        setStatus(next);
        if (next.connected) return setWaiting(false);
        if (Date.now() > deadline) {
          setWaiting(false);
          setError("The sign-in was not completed. Try Connect again.");
          return;
        }
        pollTimer.current = window.setTimeout(() => void poll().catch(() => setWaiting(false)), CONNECT_POLL_MS);
      };
      pollTimer.current = window.setTimeout(() => void poll().catch(() => setWaiting(false)), CONNECT_POLL_MS);
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setError(null);
    setBusy(true);
    window.clearTimeout(pollTimer.current);
    setWaiting(false);
    try {
      setStatus(await api.youtubeDisconnect());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, busy, waiting, error, connect, disconnect };
}
