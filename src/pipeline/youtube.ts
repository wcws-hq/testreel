// YouTube: Google OAuth for an installed app (loopback redirect, PKCE) and resumable uploads.
// The token file holds only the refresh token and the channel it belongs to. Secrets are never logged.
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { readJson, writeJson } from "./ctx.ts";
import type { Config } from "../server/config.ts";
import type { FinalMeta, UploadRecord, VideoKind, YoutubeStatus } from "../shared/types.ts";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/youtube/v3";
const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube"];
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;
const CATEGORY_SCIENCE_TECH = "28";
const MAX_TITLE = 100;
const MAX_DESCRIPTION = 5000;
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const UPLOAD_ATTEMPTS = 5;

interface StoredToken { refresh_token: string; channelId: string; channelTitle: string }
interface Tokens { access_token: string; expires_in: number; refresh_token?: string }
interface Channel { id: string; title: string }
interface VideoResource { id: string }

const NOT_CONFIGURED = "YouTube is not set up: YT_CLIENT_ID and YT_CLIENT_SECRET are missing from .env (see docs/youtube.md)";
const NOT_CONNECTED = "YouTube is not connected. Connect it in the app first.";
const SIGN_IN_EXPIRED = "The YouTube sign-in is no longer valid. Connect YouTube again.";

class AuthError extends Error {}

function isConfigured(config: Config): boolean {
  return Boolean(config.youtube.clientId && config.youtube.clientSecret);
}

function readStored(config: Config): StoredToken | null {
  const file = config.youtube.tokenFile;
  if (!existsSync(file)) return null;
  const saved = readJson<Partial<StoredToken>>(file);
  return saved.refresh_token ? (saved as StoredToken) : null;
}

function saveStored(config: Config, token: StoredToken): void {
  const file = config.youtube.tokenFile;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(token, null, 2), { mode: 0o600 });
  chmodSync(file, 0o600);
}

// ---- API errors in plain words ----

async function describeFailure(r: Response): Promise<Error> {
  const text = await r.text();
  let reason = "";
  let message = text.slice(0, 200);
  try {
    const body = JSON.parse(text) as { error?: string | { message?: string; errors?: { reason?: string }[] }; error_description?: string };
    if (typeof body.error === "string") {
      reason = body.error;
      message = body.error_description ?? body.error;
    } else if (body.error) {
      reason = body.error.errors?.[0]?.reason ?? "";
      message = body.error.message ?? message;
    }
  } catch {
    // not JSON, the raw text is the message
  }
  if (reason === "invalid_grant" || r.status === 401 || reason === "authError") return new AuthError(SIGN_IN_EXPIRED);
  if (reason === "invalid_client" || reason === "unauthorized_client") return new Error("Google rejected the YouTube client ID or secret. Check YT_CLIENT_ID and YT_CLIENT_SECRET.");
  if (["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded", "uploadLimitExceeded"].includes(reason)) {
    return new Error("YouTube refused the request because a quota was reached (uploads cost 1600 of the 10000 daily units, and channels have a daily upload limit). Try again tomorrow.");
  }
  if (reason === "youtubeSignupRequired" || reason === "channelNotFound") return new Error("The signed-in Google account has no YouTube channel. Create one, then connect again.");
  if (reason === "forbidden" || reason === "insufficientPermissions" || r.status === 403) return new Error(`YouTube denied the request (${message}). The channel may need phone verification, or the sign-in is missing a permission.`);
  return new Error(`YouTube ${r.status}${reason ? ` ${reason}` : ""}: ${message}`);
}

async function ok(r: Response): Promise<Response> {
  if (!r.ok) throw await describeFailure(r);
  return r;
}

// ---- tokens ----

async function tokenRequest(config: Config, params: Record<string, string>): Promise<Tokens> {
  const body = new URLSearchParams({ client_id: config.youtube.clientId, client_secret: config.youtube.clientSecret, ...params });
  const r = await ok(await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }));
  return (await r.json()) as Tokens;
}

let cachedAccess: { refreshToken: string; token: string; expiresAt: number } | null = null;

async function accessToken(config: Config): Promise<string> {
  if (!isConfigured(config)) throw new Error(NOT_CONFIGURED);
  const stored = readStored(config);
  if (!stored) throw new AuthError(NOT_CONNECTED);
  if (cachedAccess && cachedAccess.refreshToken === stored.refresh_token && cachedAccess.expiresAt > Date.now() + 60_000) return cachedAccess.token;
  const fresh = await tokenRequest(config, { grant_type: "refresh_token", refresh_token: stored.refresh_token });
  cachedAccess = { refreshToken: stored.refresh_token, token: fresh.access_token, expiresAt: Date.now() + fresh.expires_in * 1000 };
  return fresh.access_token;
}

async function myChannel(token: string): Promise<Channel> {
  const r = await ok(await fetch(`${API}/channels?part=snippet&mine=true`, { headers: { authorization: `Bearer ${token}` } }));
  const body = (await r.json()) as { items?: { id: string; snippet: { title: string } }[] };
  const channel = body.items?.[0];
  if (!channel) throw new Error("The signed-in Google account has no YouTube channel. Create one, then connect again.");
  return { id: channel.id, title: channel.snippet.title };
}

export async function youtubeStatus(config: Config): Promise<YoutubeStatus> {
  if (!isConfigured(config)) return { configured: false, connected: false };
  try {
    const channel = await myChannel(await accessToken(config));
    return { configured: true, connected: true, channelTitle: channel.title };
  } catch {
    return { configured: true, connected: false };
  }
}

// ---- sign-in ----

let cancelPendingSignIn: (() => void) | null = null;

export async function connectYoutube(config: Config): Promise<{ url: string; done: Promise<{ channelTitle: string }> }> {
  if (!isConfigured(config)) throw new Error(NOT_CONFIGURED);
  cancelPendingSignIn?.();

  const state = randomBytes(16).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  let deliver!: (code: string) => void;
  let fail!: (e: Error) => void;
  const code = new Promise<string>((resolve, reject) => {
    deliver = resolve;
    fail = reject;
  });
  const page = (text: string, status: number): Response => new Response(`<!doctype html><meta charset="utf-8"><title>Testreel</title><body style="background:#000;color:#fff;font:18px system-ui;display:grid;place-items:center;height:100vh;margin:0">${text}</body>`, { status, headers: { "content-type": "text/html; charset=utf-8" } });

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname !== "/") return new Response("Not found", { status: 404 });
      if (u.searchParams.get("state") !== state) return page("This sign-in link does not match the one the app started.", 400);
      const code = u.searchParams.get("code");
      const error = u.searchParams.get("error");
      if (error || !code) {
        fail(new Error(error === "access_denied" ? "The Google sign-in was cancelled." : `The Google sign-in failed: ${error ?? "no code returned"}`));
        return page("Sign-in did not finish. You can close this tab and try again in the app.", 400);
      }
      deliver(code);
      return page("Signed in. You can close this tab and go back to the app.", 200);
    },
  });
  const redirectUri = `http://127.0.0.1:${server.port}`;
  const url = `${AUTH_URL}?${new URLSearchParams({
    client_id: config.youtube.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent select_account",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  })}`;

  const timer = setTimeout(() => fail(new Error("The Google sign-in timed out after 5 minutes.")), SIGN_IN_TIMEOUT_MS);
  const cancel = (): void => fail(new Error("A newer sign-in replaced this one."));
  cancelPendingSignIn = cancel;
  const stop = (): void => {
    clearTimeout(timer);
    void server.stop();
    if (cancelPendingSignIn === cancel) cancelPendingSignIn = null;
  };

  const done = (async () => {
    try {
      const tokens = await tokenRequest(config, { grant_type: "authorization_code", code: await code, code_verifier: verifier, redirect_uri: redirectUri });
      if (!tokens.refresh_token) throw new Error("Google returned no refresh token. Remove this app at myaccount.google.com/permissions and connect again.");
      const channel = await myChannel(tokens.access_token);
      saveStored(config, { refresh_token: tokens.refresh_token, channelId: channel.id, channelTitle: channel.title });
      cachedAccess = null;
      return { channelTitle: channel.title };
    } finally {
      stop();
    }
  })();
  return { url, done };
}

export async function disconnectYoutube(config: Config): Promise<void> {
  rmSync(config.youtube.tokenFile, { force: true });
  cachedAccess = null;
}

// ---- upload ----

type Privacy = UploadRecord["privacy"];

async function startUpload(token: string, size: number, meta: FinalMeta, privacy: Privacy, publishAt: string | undefined): Promise<string> {
  const status: Record<string, unknown> = { privacyStatus: publishAt ? "private" : privacy, selfDeclaredMadeForKids: false, containsSyntheticMedia: true };
  if (publishAt) status.publishAt = publishAt;
  const body = {
    snippet: { title: meta.title, description: meta.description.replace(/[<>]/g, ""), tags: meta.tags, categoryId: CATEGORY_SCIENCE_TECH },
    status,
  };
  const r = await ok(await fetch(`${UPLOAD_API}/videos?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8", "x-upload-content-type": "video/mp4", "x-upload-content-length": String(size) },
    body: JSON.stringify(body),
  }));
  const location = r.headers.get("location");
  if (!location) throw new Error("YouTube did not return an upload address");
  return location;
}

// Sends the file in one request; after a failure asks YouTube how much arrived and continues from there.
async function sendFile(location: string, file: string, size: number): Promise<string> {
  let offset = 0;
  let lastError = "";
  for (let attempt = 0; attempt < UPLOAD_ATTEMPTS; attempt++) {
    if (attempt > 0) await Bun.sleep(attempt * 2000);
    const headers: Record<string, string> = { "content-type": "video/mp4", "content-length": String(size - offset) };
    if (offset > 0) headers["content-range"] = `bytes ${offset}-${size - 1}/${size}`;
    let r: Response | undefined;
    try {
      r = await fetch(location, { method: "PUT", headers, body: Bun.file(file).slice(offset) });
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    if (r?.ok) return ((await r.json()) as VideoResource).id;
    if (r) {
      if (r.status < 500) throw await describeFailure(r);
      lastError = `YouTube answered ${r.status}`;
    }
    try {
      const probe = await fetch(location, { method: "PUT", headers: { "content-length": "0", "content-range": `bytes */${size}` } });
      if (probe.ok) return ((await probe.json()) as VideoResource).id;
      if (probe.status !== 308) throw await describeFailure(probe);
      const received = probe.headers.get("range")?.match(/bytes=0-(\d+)/)?.[1];
      offset = received ? Number(received) + 1 : 0;
    } catch (e) {
      if (e instanceof AuthError) throw e;
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`The upload kept failing: ${lastError}`);
}

export async function uploadVideo(runDir: string, config: Config, kind: VideoKind, opts: { privacy: Privacy; publishAt?: string }): Promise<UploadRecord> {
  const dir = `${runDir}/final/${kind}`;
  const metaFile = `${dir}/meta.json`;
  const video = `${dir}/video.mp4`;
  if (!existsSync(metaFile) || !existsSync(video)) throw new Error(`The ${kind} video is not packaged yet`);
  const meta = readJson<FinalMeta>(metaFile);
  const thumb = `${dir}/thumb-${meta.thumbnail}.jpg`;
  if (!existsSync(thumb)) throw new Error(`The chosen thumbnail thumb-${meta.thumbnail}.jpg is missing`);
  if (statSync(thumb).size > MAX_THUMBNAIL_BYTES) throw new Error("The thumbnail is over YouTube's 2 MB limit");
  if (meta.title.length > MAX_TITLE) throw new Error(`The title is ${meta.title.length} characters, YouTube allows ${MAX_TITLE}`);
  if (meta.description.length > MAX_DESCRIPTION) throw new Error(`The description is ${meta.description.length} characters, YouTube allows ${MAX_DESCRIPTION}`);
  if (opts.publishAt && !(Date.parse(opts.publishAt) > Date.now())) throw new Error("The scheduled publish time must be a valid date in the future");

  const token = await accessToken(config);
  const location = await startUpload(token, statSync(video).size, meta, opts.privacy, opts.publishAt);
  const videoId = await sendFile(location, video, statSync(video).size);

  const record: UploadRecord = { kind, videoId, url: `https://www.youtube.com/watch?v=${videoId}`, privacy: opts.publishAt ? "private" : opts.privacy, at: Date.now() };
  if (opts.publishAt) record.publishAt = new Date(opts.publishAt).toISOString();
  const logFile = `${runDir}/uploads.json`;
  writeJson(logFile, [...(existsSync(logFile) ? readJson<UploadRecord[]>(logFile) : []), record]);

  try {
    await ok(await fetch(`${UPLOAD_API}/thumbnails/set?videoId=${videoId}&uploadType=media`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "image/jpeg", "content-length": String(statSync(thumb).size) },
      body: Bun.file(thumb),
    }));
  } catch (e) {
    throw new Error(`The video is uploaded (${record.url}) but the thumbnail was not set: ${e instanceof Error ? e.message : String(e)}`);
  }
  return record;
}
