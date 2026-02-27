import { logger } from "../logger";
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { META_DIRECTORY } from "../const";

export type AuthTokens = {
  identityToken: string;
  sessionToken: string;
};

const DEFAULT_AUTH_URL = "https://butter.lat/auth/login";
const DEFAULT_TIMEOUT_MS = 5_000;
// Because obviously the internet always responds instantly.

const OFFICIAL_ACCOUNT_DATA_BASE = "https://account-data.hytale.com";
const OFFICIAL_SESSIONS_BASE = "https://sessions.hytale.com";
const DEFAULT_HYTALE_LAUNCHER_UA = "hytale-launcher/2026.02.12-54e579b";
const OFFICIAL_ISSUER = "https://sessions.hytale.com";

const BUTTER_SESSIONS_BASE =
  String(process.env.BUTTER_SESSIONS_BASE ?? process.env.VITE_BUTTER_SESSIONS_BASE ?? "").trim() ||
  "https://sessions.butter.lat";

const premiumHttpDebugEnabled = () => {
  const raw = String(process.env.HYTALE_PREMIUM_HTTP_DEBUG ?? process.env.PREMIUM_HTTP_DEBUG ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
};

const redactAuth = (headers: Record<string, string>): Record<string, string> => {
  const out: Record<string, string> = { ...headers };
  for (const k of Object.keys(out)) {
    if (k.toLowerCase() === "authorization") out[k] = "<redacted>";
  }
  return out;
};

const snippet = (s: string, maxLen: number = 600) => {
  const t = String(s ?? "");
  return t.length > maxLen ? `${t.slice(0, maxLen)}…` : t;
};

const logPremiumHttp = (level: "info" | "warn" | "error", msg: string, data: any) => {
  if (!premiumHttpDebugEnabled() && level === "info") return;
  (logger as any)[level](msg, data);
};

const PREMIUM_AUTH_FILE = path.join(META_DIRECTORY, "premium-auth.json");

const OFFLINE_TOKENS_FILE = path.join(META_DIRECTORY, "offline-tokens.json");
const BUTTER_JWKS_CACHE_FILE = path.join(META_DIRECTORY, "butter-jwks.json");
const OFFICIAL_JWKS_CACHE_FILE = path.join(META_DIRECTORY, "official-jwks.json");

type OfflineTokensStore = {
  updatedAt?: string;
  // New: store tokens by issuer so we can keep multiple variants.
  tokensByIssuer?: Record<string, Record<string, string>>;
  // Legacy: older versions stored just one token map by uuid.
  tokens?: Record<string, string>;
};

type Jwks = { keys: any[] };

const readButterJwksBestEffort = (): Jwks | null => {
  try {
    if (!fs.existsSync(BUTTER_JWKS_CACHE_FILE)) return null;
    const raw = fs.readFileSync(BUTTER_JWKS_CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const keys = parsed && typeof parsed === "object" ? (parsed as any).keys : null;
    if (!Array.isArray(keys)) return null;
    return { keys };
  } catch {
    return null;
  }
};

const writeButterJwksBestEffort = (jwks: Jwks) => {
  try {
    fs.mkdirSync(path.dirname(BUTTER_JWKS_CACHE_FILE), { recursive: true });
    const tmp = BUTTER_JWKS_CACHE_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(jwks, null, 2), "utf8");
    fs.renameSync(tmp, BUTTER_JWKS_CACHE_FILE);
  } catch {
    // ignore
  }
};

const refreshButterJwks = async (): Promise<Jwks> => {
  const url = `${BUTTER_SESSIONS_BASE}/.well-known/jwks.json`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(url, { method: "GET", signal: ctrl.signal, headers: { Accept: "application/json" } });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      throw new Error(`Failed to fetch Butter JWKS (HTTP ${res.status})`);
    }
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    const keys = json && typeof json === "object" ? json.keys : null;
    if (!Array.isArray(keys) || keys.length < 1) {
      throw new Error("Butter JWKS invalid or empty");
    }
    const jwks: Jwks = { keys };
    writeButterJwksBestEffort(jwks);
    return jwks;
  } finally {
    try {
      clearTimeout(timer);
    } catch {
      // ignore
    }
  }
};

export const ensureButterJwks = async (opts?: { forceRefresh?: boolean }): Promise<Jwks | null> => {
  if (!opts?.forceRefresh) {
    const cached = readButterJwksBestEffort();
    if (cached) return cached;
  }
  try {
    return await refreshButterJwks();
  } catch {
    // If network fails, fall back to cache.
    return readButterJwksBestEffort();
  }
};

const readOfficialJwksBestEffort = (): Jwks | null => {
  try {
    if (!fs.existsSync(OFFICIAL_JWKS_CACHE_FILE)) return null;
    const raw = fs.readFileSync(OFFICIAL_JWKS_CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const keys = parsed && typeof parsed === "object" ? (parsed as any).keys : null;
    if (!Array.isArray(keys)) return null;
    return { keys };
  } catch {
    return null;
  }
};

const writeOfficialJwksBestEffort = (jwks: Jwks) => {
  try {
    fs.mkdirSync(path.dirname(OFFICIAL_JWKS_CACHE_FILE), { recursive: true });
    const tmp = OFFICIAL_JWKS_CACHE_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(jwks, null, 2), "utf8");
    fs.renameSync(tmp, OFFICIAL_JWKS_CACHE_FILE);
  } catch {
    // ignore
  }
};

const refreshOfficialJwks = async (): Promise<Jwks> => {
  const url = `${OFFICIAL_SESSIONS_BASE}/.well-known/jwks.json`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(url, { method: "GET", signal: ctrl.signal, headers: { Accept: "application/json" } });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      throw new Error(`Failed to fetch Official JWKS (HTTP ${res.status})`);
    }
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    const keys = json && typeof json === "object" ? json.keys : null;
    if (!Array.isArray(keys) || keys.length < 1) {
      throw new Error("Official JWKS invalid or empty");
    }
    const jwks: Jwks = { keys };
    writeOfficialJwksBestEffort(jwks);
    return jwks;
  } finally {
    try {
      clearTimeout(timer);
    } catch {
      // ignore
    }
  }
};

export const ensureOfficialJwks = async (opts?: { forceRefresh?: boolean }): Promise<Jwks | null> => {
  if (!opts?.forceRefresh) {
    const cached = readOfficialJwksBestEffort();
    if (cached) return cached;
  }
  try {
    return await refreshOfficialJwks();
  } catch {
    return readOfficialJwksBestEffort();
  }
};

const readOfflineTokensStoreBestEffort = (): OfflineTokensStore => {
  try {
    if (!fs.existsSync(OFFLINE_TOKENS_FILE)) return { tokens: {} };
    const raw = fs.readFileSync(OFFLINE_TOKENS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { tokens: {} };

    const tokensByIssuerRaw = (parsed as any).tokensByIssuer;
    const tokensRaw = (parsed as any).tokens;

    const tokensByIssuer =
      tokensByIssuerRaw && typeof tokensByIssuerRaw === "object"
        ? (tokensByIssuerRaw as Record<string, Record<string, string>>)
        : undefined;

    const tokens =
      tokensRaw && typeof tokensRaw === "object"
        ? (tokensRaw as Record<string, string>)
        : undefined;

    return {
      updatedAt: (parsed as any).updatedAt,
      tokensByIssuer,
      tokens,
    };
  } catch {
    return { tokens: {} };
  }
};

const writeOfflineTokensStoreBestEffort = (next: OfflineTokensStore) => {
  try {
    fs.mkdirSync(path.dirname(OFFLINE_TOKENS_FILE), { recursive: true });
    const tmp = OFFLINE_TOKENS_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
    fs.renameSync(tmp, OFFLINE_TOKENS_FILE);
  } catch {
    // ignore
  }
};

export const readStoredOfflineTokenBestEffort = (
  uuid: string,
  issuer?: string | null,
): string | null => {
  const u = String(uuid ?? "").trim().toLowerCase();
  if (!u) return null;
  const st = readOfflineTokensStoreBestEffort();

  const iss = String(issuer ?? "").trim();
  if (iss) {
    const tok = st.tokensByIssuer?.[iss]?.[u] ?? null;
    return typeof tok === "string" && tok.trim() ? tok.trim() : null;
  }

  // Fallback: prefer butter issuer (patched), then official issuer, then legacy map.
  const fromButter = st.tokensByIssuer?.[BUTTER_SESSIONS_BASE]?.[u] ?? null;
  if (typeof fromButter === "string" && fromButter.trim()) return fromButter.trim();
  const fromOfficial = st.tokensByIssuer?.[OFFICIAL_ISSUER]?.[u] ?? null;
  if (typeof fromOfficial === "string" && fromOfficial.trim()) return fromOfficial.trim();

  const legacy = st.tokens?.[u] ?? null;
  return typeof legacy === "string" && legacy.trim() ? legacy.trim() : null;
};

const storeOfflineTokenBestEffort = (uuid: string, issuer: string, token: string) => {
  const u = String(uuid ?? "").trim().toLowerCase();
  const iss = String(issuer ?? "").trim();
  const t = String(token ?? "").trim();
  if (!u || !iss || !t) return;
  const cur = readOfflineTokensStoreBestEffort();

  const tokensByIssuer: Record<string, Record<string, string>> = {
    ...(cur.tokensByIssuer ?? {}),
  };
  const bucket = { ...(tokensByIssuer[iss] ?? {}) };
  bucket[u] = t;
  tokensByIssuer[iss] = bucket;

  writeOfflineTokensStoreBestEffort({
    updatedAt: new Date().toISOString(),
    tokensByIssuer,
    // Keep legacy field as a best-effort compatibility mirror.
    tokens: { ...(cur.tokens ?? {}), [u]: t },
  });
};

const readPremiumTokenObjectBestEffort = (): any | null => {
  try {
    if (!fs.existsSync(PREMIUM_AUTH_FILE)) return null;
    const raw = fs.readFileSync(PREMIUM_AUTH_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const tok = (parsed as any)?.token;
    if (!tok || typeof tok !== "object") return null;
    return tok;
  } catch {
    return null;
  }
};

const readPremiumAccessTokenBestEffort = (): string | null => {
  const tok = readPremiumTokenObjectBestEffort();
  const access = typeof tok?.access_token === "string" ? tok.access_token.trim() : "";
  return access ? access : null;
};

const writePremiumTokenObjectBestEffort = (nextToken: any) => {
  try {
    if (!fs.existsSync(PREMIUM_AUTH_FILE)) return;
    const raw = fs.readFileSync(PREMIUM_AUTH_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    (parsed as any).token = nextToken;
    (parsed as any).obtainedAt = new Date().toISOString();
    fs.writeFileSync(PREMIUM_AUTH_FILE, JSON.stringify(parsed, null, 2), "utf8");
  } catch {
    // ignore
  }
};

const nowSec = () => Math.floor(Date.now() / 1000);

const getTokenExpiresAtSec = (tok: any): number | null => {
  const expiresAt = typeof tok?.expires_at === "number" && Number.isFinite(tok.expires_at) ? Math.floor(tok.expires_at) : null;
  if (expiresAt) return expiresAt;
  const obtainedAt = typeof tok?.obtained_at === "number" && Number.isFinite(tok.obtained_at) ? Math.floor(tok.obtained_at) : null;
  const expiresIn = typeof tok?.expires_in === "number" && Number.isFinite(tok.expires_in) ? Math.floor(tok.expires_in) : null;
  if (obtainedAt && expiresIn) return obtainedAt + expiresIn;
  return null;
};

const refreshPremiumAccessTokenIfNeeded = async (): Promise<string | null> => {
  const tok = readPremiumTokenObjectBestEffort();
  if (!tok) return null;

  const access = typeof tok?.access_token === "string" ? tok.access_token.trim() : "";
  const refresh = typeof tok?.refresh_token === "string" ? tok.refresh_token.trim() : "";
  if (!refresh) return access || null;

  const expiresAt = getTokenExpiresAtSec(tok);
  const skew = 90;
  if (access && typeof expiresAt === "number" && expiresAt - skew > nowSec()) return access;

  const tokenUrlRaw =
    String(process.env.HYTALE_OAUTH_TOKEN_URL ?? "").trim() ||
    "https://oauth.accounts.hytale.com/oauth2/token";

  // Match official launcher: Basic auth with client_id "hytale-launcher" and empty secret.
  const basicAuth = `Basic ${Buffer.from("hytale-launcher:").toString("base64")}`;
  const userAgent =
    String(process.env.HYTALE_OAUTH_USER_AGENT ?? process.env.HYTALE_LAUNCHER_USER_AGENT ?? "").trim() ||
    "hytale-launcher/2026.02.06-b95ae53";
  const launcherBranch =
    String(process.env.HYTALE_OAUTH_LAUNCHER_BRANCH ?? process.env.HYTALE_LAUNCHER_BRANCH ?? "").trim() ||
    "release";
  const launcherVersion =
    String(process.env.HYTALE_OAUTH_LAUNCHER_VERSION ?? process.env.HYTALE_LAUNCHER_VERSION ?? "").trim() ||
    "2026.02.06-b95ae53";

  try {
    const tokenUrl = new URL(tokenUrlRaw);
    const body = new URLSearchParams();
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", refresh);

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": userAgent,
      Authorization: basicAuth,
    };
    if (launcherBranch) headers["X-Hytale-Launcher-Branch"] = launcherBranch;
    if (launcherVersion) headers["X-Hytale-Launcher-Version"] = launcherVersion;

    const resp = await fetch(tokenUrl.toString(), { method: "POST", headers, body });
    const text = await resp.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    if (!resp.ok) {
      logPremiumHttp("warn", "Premium HTTP refresh_token response", {
        req: {
          method: "POST",
          url: tokenUrl.toString(),
          headers: redactAuth(headers),
          body: "grant_type=refresh_token&refresh_token=<redacted>",
        },
        res: { status: resp.status, body: snippet(text, 800) },
      });
      return access || null;
    }

    const nextAccess = typeof json?.access_token === "string" ? json.access_token.trim() : "";
    if (!nextAccess) return access || null;

    const obtainedAt = nowSec();
    const expiresIn = typeof json?.expires_in === "number" && Number.isFinite(json.expires_in) ? Math.floor(json.expires_in) : 3600;
    const expiresAt = obtainedAt + Math.max(1, expiresIn);

    const merged = {
      ...tok,
      ...json,
      access_token: nextAccess,
      refresh_token:
        typeof json?.refresh_token === "string" && json.refresh_token.trim()
          ? json.refresh_token.trim()
          : tok.refresh_token,
      obtained_at: obtainedAt,
      expires_in: expiresIn,
      expires_at: expiresAt,
    };
    writePremiumTokenObjectBestEffort(merged);
    return nextAccess;
  } catch (e) {
    logger.warn("Premium token refresh threw", e);
    return access || null;
  }
};

const officialLauncherHeaders = (accessToken: string): Record<string, string> => {
  const userAgent =
    String(process.env.HYTALE_LAUNCHER_USER_AGENT ?? "").trim() ||
    String(process.env.HYTALE_CLIENT_USER_AGENT ?? "").trim() ||
    DEFAULT_HYTALE_LAUNCHER_UA;

  const launcherBranch =
    String(process.env.HYTALE_LAUNCHER_BRANCH ?? "").trim() ||
    String(process.env.HYTALE_OAUTH_LAUNCHER_BRANCH ?? "").trim() ||
    "release";

  const launcherVersion =
    String(process.env.HYTALE_LAUNCHER_VERSION ?? "").trim() ||
    String(process.env.HYTALE_OAUTH_LAUNCHER_VERSION ?? "").trim() ||
    userAgent.split("/")[1] ||
    "";

  const h: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": userAgent,
    Authorization: `Bearer ${accessToken}`,
    "X-Hytale-Launcher-Branch": launcherBranch,
  };
  if (launcherVersion) h["X-Hytale-Launcher-Version"] = launcherVersion;
  // fetch will transparently decode gzip; adding the header keeps parity.
  h["Accept-Encoding"] = "gzip";
  return h;
};

export type PremiumLauncherProfile = {
  username: string;
  uuid: string;
};

const readPremiumStoredProfileBestEffort = (): PremiumLauncherProfile | null => {
  try {
    if (!fs.existsSync(PREMIUM_AUTH_FILE)) return null;
    const raw = fs.readFileSync(PREMIUM_AUTH_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const p = (parsed as any)?.profile;
    const username = typeof p?.username === "string" ? p.username.trim() : "";
    const uuid = typeof p?.uuid === "string" ? p.uuid.trim() : "";
    if (!username || !uuid) return null;
    return { username, uuid };
  } catch {
    return null;
  }
};

const normalizeOfficialUuid = (raw: unknown): string | null => {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return null;
  if (
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      s,
    )
  ) {
    return s.toLowerCase();
  }
  return null;
};

const normalizeOfficialUsername = (raw: unknown): string | null => {
  const s = typeof raw === "string" ? raw.trim() : "";
  return s ? s : null;
};

const getOfficialOsArch = (): { os: string; arch: string } => {
  const os =
    process.platform === "win32"
      ? "windows"
      : process.platform === "darwin"
        ? "macos"
        : "linux";
  const arch = process.arch === "x64" ? "amd64" : process.arch;
  return { os, arch };
};

export const fetchPremiumLauncherPrimaryProfile = async (
  opts?: { forceNetwork?: boolean },
): Promise<PremiumLauncherProfile> => {
  const forceNetwork = !!opts?.forceNetwork;
  if (!forceNetwork) {
    const cached = readPremiumStoredProfileBestEffort();
    if (cached) return cached;
  }

  const accessToken =
    (await refreshPremiumAccessTokenIfNeeded()) ?? readPremiumAccessTokenBestEffort();
  if (!accessToken) {
    throw new Error("Premium login required (missing access token)");
  }

  const { os, arch } = getOfficialOsArch();
  const url = `${OFFICIAL_ACCOUNT_DATA_BASE}/my-account/get-launcher-data?arch=${encodeURIComponent(
    arch,
  )}&os=${encodeURIComponent(os)}`;

  const res = await fetch(url, { method: "GET", headers: officialLauncherHeaders(accessToken) });
  logPremiumHttp("info", "Premium HTTP get-launcher-data", {
    req: { method: "GET", url, headers: redactAuth(officialLauncherHeaders(accessToken)) },
    res: { status: res.status },
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    logPremiumHttp("warn", "Premium HTTP get-launcher-data response", {
      req: { method: "GET", url, headers: redactAuth(officialLauncherHeaders(accessToken)) },
      res: { status: res.status, body: snippet(bodyText, 800) },
    });
    throw new Error(`get-launcher-data failed (HTTP ${res.status})${bodyText ? `: ${snippet(bodyText, 200)}` : ""}`);
  }
  const rawBody = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(rawBody);
  } catch {
    json = null;
  }
  logPremiumHttp("info", "Premium HTTP get-launcher-data body", {
    res: {
      status: res.status,
      body: snippet(rawBody, 1200),
    },
  });
  if (!json) throw new Error("get-launcher-data returned non-JSON response");
  const profiles: any[] = Array.isArray(json?.profiles) ? json.profiles : [];
  const pickBestProfile = (): any | null => {
    if (!profiles.length) return null;
    // Prefer a profile that has the base game entitlement.
    const withEntitlement = profiles.find((p) => {
      const ent = Array.isArray(p?.entitlements) ? p.entitlements : [];
      return ent.includes("game.base");
    });
    return withEntitlement ?? profiles[0];
  };

  const best = pickBestProfile();
  const username = normalizeOfficialUsername(best?.username);
  const uuid = normalizeOfficialUuid(best?.uuid);
  if (!username || !uuid) {
    throw new Error("get-launcher-data returned no valid profile username/uuid");
  }

  return { username, uuid };
};

export const createPremiumGameSession = async (profileUuid: string): Promise<AuthTokens> => {
  const accessToken =
    (await refreshPremiumAccessTokenIfNeeded()) ?? readPremiumAccessTokenBestEffort();
  if (!accessToken) {
    throw new Error("Premium login required (missing access token)");
  }

  const url = `${OFFICIAL_SESSIONS_BASE}/game-session/new`;
  const reqHeaders = {
    ...officialLauncherHeaders(accessToken),
    "Content-Type": "application/json",
  };
  // Must match official launcher format.
  // Example payload length is 48 bytes: {"uuid":"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"}
  const reqBodyObj = { uuid: profileUuid };
  const reqBody = JSON.stringify(reqBodyObj);

  logPremiumHttp("info", "Premium HTTP game-session/new", {
    req: {
      method: "POST",
      url,
      headers: redactAuth(reqHeaders),
      body: {
        uuid: `${profileUuid.slice(0, 8)}…${profileUuid.slice(-6)}`,
        contentLength: Buffer.byteLength(reqBody),
      },
    },
  });

  const res = await fetch(url, {
    method: "POST",
    headers: reqHeaders,
    body: reqBody,
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  if (!res.ok) {
    logPremiumHttp("warn", "Premium HTTP game-session/new response", {
      req: {
        method: "POST",
        url,
        headers: redactAuth(reqHeaders),
        body: { uuid: `${profileUuid.slice(0, 8)}…${profileUuid.slice(-6)}` },
      },
      res: { status: res.status, body: snippet(text, 1200) },
    });
    throw new Error(
      `game-session/new failed (HTTP ${res.status})${text ? `: ${text.slice(0, 200)}` : ""}`,
    );
  }

  logPremiumHttp("info", "Premium HTTP game-session/new body", {
    res: { status: res.status, body: snippet(text, 1200) },
  });

  const identityToken = typeof json?.identityToken === "string" ? json.identityToken.trim() : "";
  const sessionToken = typeof json?.sessionToken === "string" ? json.sessionToken.trim() : "";
  if (!identityToken || !sessionToken) {
    throw new Error("game-session/new returned missing identityToken/sessionToken");
  }

  return { identityToken, sessionToken };
};

export const fetchPremiumLaunchAuth = async (): Promise<{
  username: string;
  uuid: string;
  identityToken: string;
  sessionToken: string;
}> => {
  const profile = await fetchPremiumLauncherPrimaryProfile();
  try {
    const tokens = await createPremiumGameSession(profile.uuid);
    return { ...profile, ...tokens };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // If the cached profile is stale/wrong, re-fetch launcher-data and retry once.
    if (/invalid game account for user/i.test(msg)) {
      const freshProfile = await fetchPremiumLauncherPrimaryProfile({ forceNetwork: true });
      const tokens = await createPremiumGameSession(freshProfile.uuid);
      return { ...freshProfile, ...tokens };
    }
    throw e;
  }
};

const readEnvBool = (raw: unknown): boolean | null => {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(v)) return true;
  if (["0", "false", "no", "n", "off"].includes(v)) return false;
  return null;
};

const postJson = async (
  url: string,
  payload: unknown,
  timeoutMs: number,
  insecure: boolean,
): Promise<{ status: number; bodyText: string }> => {
  const u = new URL(url);
  const body = JSON.stringify(payload);
  // Turning objects into strings: the timeless art of pretending everything is fine.

  const isHttps = u.protocol === "https:";
  const transport = isHttps ? https : http;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body).toString(),
    Accept: "application/json",
  };

  const agent =
    isHttps && insecure
      ? new https.Agent({ rejectUnauthorized: false })
      : undefined;
  // Yes, this can disable TLS verification. No, this isn't a good idea. But devs gonna dev.

  return await new Promise((resolve, reject) => {
    const req = transport.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port ? Number(u.port) : undefined,
        path: `${u.pathname}${u.search}`,
        method: "POST",
        headers,
        agent,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on("end", () => {
          const bodyText = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 0, bodyText });
        });
      },
    );

    req.on("error", reject);

    // Socket/request timeout.
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("timeout"));
    });
    // If it hangs longer than this, it probably wasn't meant to be.

    req.write(body);
    req.end();
  });
};

const postJsonFetch = async (opts: {
  url: string;
  payload: unknown;
  headers: Record<string, string>;
  timeoutMs: number;
}): Promise<{ status: number; bodyText: string }> => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(250, opts.timeoutMs));
  try {
    const body = JSON.stringify(opts.payload ?? {});
    const res = await fetch(opts.url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...opts.headers,
      },
      body,
      signal: ctrl.signal,
    });
    const text = await res.text().catch(() => "");
    return { status: res.status, bodyText: text };
  } finally {
    try {
      clearTimeout(timer);
    } catch {
      // ignore
    }
  }
};

const extractOfflineTokenFromResponse = (uuid: string, bodyText: string): string | null => {
  const u = String(uuid ?? "").trim().toLowerCase();
  if (!u) return null;
  let json: any = null;
  try {
    json = JSON.parse(bodyText);
  } catch {
    json = null;
  }
  const map = json && typeof json === "object" ? (json as any).offlineTokens : null;
  if (!map || typeof map !== "object") return null;
  const tok = (map as any)[u] ?? (map as any)[uuid] ?? null;
  return typeof tok === "string" && tok.trim() ? tok.trim() : null;
};

const extractOfflineTokenFromResponseField = (
  uuid: string,
  bodyText: string,
  field: string,
): string | null => {
  const u = String(uuid ?? "").trim().toLowerCase();
  if (!u) return null;
  let json: any = null;
  try {
    json = JSON.parse(bodyText);
  } catch {
    json = null;
  }
  const map = json && typeof json === "object" ? (json as any)[field] : null;
  if (!map || typeof map !== "object") return null;
  const tok = (map as any)[u] ?? (map as any)[uuid] ?? null;
  return typeof tok === "string" && tok.trim() ? tok.trim() : null;
};

export const refreshOfflineToken = async (opts: {
  accountType: "premium" | "nopremium";
  username: string;
  uuid: string;
  issuer?: string | null;
}): Promise<string> => {
  const timeoutMs = 8_000;
  const uuid = String(opts.uuid ?? "").trim().toLowerCase();
  const username = String(opts.username ?? "").trim();
  if (!uuid) throw new Error("Missing uuid");
  if (!username && opts.accountType !== "premium") throw new Error("Missing username");

  if (opts.accountType === "premium") {
    const accessToken =
      (await refreshPremiumAccessTokenIfNeeded()) ?? readPremiumAccessTokenBestEffort();
    if (!accessToken) throw new Error("Premium login required (missing access token)");

    const url = `${OFFICIAL_SESSIONS_BASE}/game-session/offline`;
    const reqHeaders = {
      ...officialLauncherHeaders(accessToken),
    };

    logPremiumHttp("info", "Premium HTTP game-session/offline", {
      req: { method: "POST", url, headers: redactAuth(reqHeaders) },
    });

    const { status, bodyText } = await postJsonFetch({
      url,
      payload: { uuid },
      headers: reqHeaders,
      timeoutMs,
    });

    if (status !== 200) {
      logPremiumHttp("warn", "Premium HTTP game-session/offline response", {
        req: { method: "POST", url, headers: redactAuth(reqHeaders) },
        res: { status, body: snippet(bodyText, 1200) },
      });
      throw new Error(`game-session/offline failed (HTTP ${status})`);
    }

    const tok = extractOfflineTokenFromResponse(uuid, bodyText);
    if (!tok) {
      logPremiumHttp("warn", "Premium HTTP game-session/offline missing token", {
        res: { status, body: snippet(bodyText, 1200) },
      });
      throw new Error("game-session/offline returned missing offline token");
    }
    storeOfflineTokenBestEffort(uuid, OFFICIAL_ISSUER, tok);
    return tok;
  }

  // No-premium (Butter sessions)
  const tokens = await fetchAuthTokens(username, uuid);
  const url = `${BUTTER_SESSIONS_BASE}/game-session/offline`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${tokens.identityToken}`,
  };

  const { status, bodyText } = await postJsonFetch({
    url,
    payload: { uuid },
    headers,
    timeoutMs,
  });

  if (status !== 200) {
    const sn = snippet(bodyText, 800);
    throw new Error(`Butter game-session/offline failed (HTTP ${status})${sn ? `: ${sn}` : ""}`);
  }

  // No-premium endpoint can return multiple variants.
  const butterToken = extractOfflineTokenFromResponse(uuid, bodyText);
  const officialIssuerToken = extractOfflineTokenFromResponseField(
    uuid,
    bodyText,
    "offlineTokensOfficialIssuer",
  );

  if (butterToken) storeOfflineTokenBestEffort(uuid, "https://sessions.butter.lat", butterToken);
  if (officialIssuerToken) storeOfflineTokenBestEffort(uuid, OFFICIAL_ISSUER, officialIssuerToken);

  const wantIssuer = String(opts.issuer ?? "").trim();
  if (wantIssuer === OFFICIAL_ISSUER) {
    if (officialIssuerToken) return officialIssuerToken;
    throw new Error("Butter game-session/offline missing official-issuer offline token");
  }

  // Default to butter issuer.
  if (butterToken) return butterToken;
  throw new Error("Butter game-session/offline returned missing offline token");
};

export const ensureOfflineToken = async (opts: {
  accountType: "premium" | "nopremium";
  username: string;
  uuid: string;
  issuer?: string | null;
  forceRefresh?: boolean;
}): Promise<string> => {
  const uuid = String(opts.uuid ?? "").trim().toLowerCase();
  if (!uuid) throw new Error("Missing uuid");

  if (!opts.forceRefresh) {
    const cached = readStoredOfflineTokenBestEffort(uuid, opts.issuer ?? null);
    if (cached) return cached;
  }

  return await refreshOfflineToken({
    accountType: opts.accountType,
    username: opts.username,
    uuid,
    issuer: opts.issuer ?? null,
  });
};

export const fetchAuthTokens = async (
  username: string,
  uuid: string,
): Promise<AuthTokens> => {
  const authUrl = (process.env.VITE_AUTH_URL || process.env.AUTH_URL || "").trim() ||
    DEFAULT_AUTH_URL;
  // One URL to rule them all (and occasionally return HTML by mistake).

  const timeoutMsRaw =
    (process.env.VITE_AUTH_TIMEOUT_MS || process.env.AUTH_TIMEOUT_MS || "").trim();
  const timeoutMs = timeoutMsRaw ? Number(timeoutMsRaw) : DEFAULT_TIMEOUT_MS;

  const insecure =
    readEnvBool(process.env.VITE_AUTH_INSECURE) ??
    readEnvBool(process.env.AUTH_INSECURE) ??
    false;

  const effectiveTimeout =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;

  if (insecure) {
    logger.warn(
      "VITE_AUTH_INSECURE enabled: TLS certificate verification is disabled for auth requests.",
    );
  }
  // If you're reading this in prod: please stop.

  try {
    const { status, bodyText } = await postJson(
      authUrl,
      { username, uuid },
      effectiveTimeout,
      insecure,
    );

    if (status !== 200) {
      const snippet = (bodyText || "").slice(0, 400);
      throw new Error(
        `Auth server error (${status}).` +
          (snippet ? ` Response: ${snippet}` : ""),
      );
    }

    let data: any;
    try {
      data = JSON.parse(bodyText);
    } catch {
      const snippet = (bodyText || "").slice(0, 400);
      throw new Error(
        "Auth server did not return valid JSON." +
          (snippet ? ` Response: ${snippet}` : ""),
      );
    }
    // JSON: where all strings are valid until proven otherwise.

    const identityToken =
      typeof data?.identityToken === "string" ? data.identityToken : null;
    const sessionToken =
      typeof data?.sessionToken === "string" ? data.sessionToken : null;

    if (!identityToken || !sessionToken) {
      throw new Error("Auth server JSON missing identityToken/sessionToken.");
    }
    // Great, we got tokens. Now let's hope the game agrees.

    return { identityToken, sessionToken };
  } catch (e) {
    if (e instanceof Error && e.message === "timeout") {
      throw new Error(`Auth request timed out after ${effectiveTimeout}ms.`);
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
};

export const fetchAuthTokensPremium = async (
  _username: string,
  _uuid: string,
): Promise<AuthTokens> => {
  const r = await fetchPremiumLaunchAuth();
  return { identityToken: r.identityToken, sessionToken: r.sessionToken };
};
