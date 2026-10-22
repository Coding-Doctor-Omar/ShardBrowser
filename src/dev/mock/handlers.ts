// One handler per Tauri command the frontend invokes. Handlers mutate the
// mock state in place and return what the Rust command would return; a throw
// rejects the invoke the way a Rust `Err` does (the app renders `String(e)`).
import type { MockState, StoredProfile } from "./fixtures";
import {
  seed, metaOf, PS_ME, PS_PRODUCTS, PS_AVAILABLE, PS_ACTIVE, PS_TRAFFIC, psUsage,
  PS_COUNTRIES, PS_REGIONS, PS_CITIES, PS_ISPS,
} from "./fixtures";
import { newId, sleep } from "./store";
import type { ProxyEntry, ProxyTestSnapshot } from "../../entities/proxy/model/types";
import type { FingerprintEntry } from "../../entities/fingerprint/model/types";
import type { Project, RunState, ModuleInfo } from "../../entities/automation/model/types";

export type Ctx = {
  state: MockState;
  save: () => void;
  emit: (event: string, payload?: unknown) => void;
};

type Args = Record<string, any>;
export type Handler = (args: Args, ctx: Ctx) => unknown;

/** Launcher-side timestamps: "@<unix seconds>", the format profile.rs writes. */
const nowStamp = () => `@${Math.floor(Date.now() / 1000)}`;

// The library's vocabulary, as the backend's host_platform answers.
function hostPlatform(): string {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "Windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "macOS";
  return "Linux";
}

function profile(state: MockState, id: string): StoredProfile {
  const p = state.profiles[id];
  if (!p) throw `profile ${id} not found`;
  return p;
}

function changed(ctx: Ctx, topic = "profiles") {
  ctx.save();
  // As the backend (lib.rs notify_store_changed): the topic is the payload.
  ctx.emit("store-changed", topic);
}

function stopProcess(state: MockState, id: string): boolean {
  const run = state.running[id];
  if (!run) return false;
  const p = state.profiles[id];
  if (p) p._meta.total_runtime_ms += Date.now() - run.started;
  delete state.running[id];
  return true;
}

function startProcess(state: MockState, id: string): number {
  const p = profile(state, id);
  if (state.running[id]) return state.running[id].pid;
  const pid = state.nextPid++;
  state.running[id] = { pid, started: Date.now() };
  p._meta.last_launched_at = nowStamp();
  if (p._meta.launches !== undefined) p._meta.launches += 1;
  return pid;
}

function cloneProfile(src: StoredProfile, name: string): StoredProfile {
  const copy = JSON.parse(JSON.stringify(src)) as StoredProfile;
  copy._meta = { ...copy._meta, id: newId(), rev: 1, created_at: nowStamp(), last_launched_at: null, total_runtime_ms: 0, pinned: false };
  copy.name = name;
  return copy;
}

function profileFromFingerprint(fp: FingerprintEntry, name: string, folder = ""): StoredProfile {
  const nav = { ...(fp.payload?.navigator ?? {}) } as Record<string, unknown>;
  return {
    _meta: {
      id: newId(), rev: 1, proxy_id: null, last_launched_at: null, created_at: nowStamp(),
      pinned: false, folder, total_runtime_ms: 0, gpu_preset_id: fp.id, extensions: [],
      ...(fp.platform.startsWith("Linux arm") ? { android_media: true } : {}),
    },
    name,
    notes: "",
    timezone: "auto",
    icu_locale: null,
    webrtc: "auto",
    navigator: { ...nav, do_not_track: null },
    client_hints: { ...(fp.payload?.client_hints ?? {}) },
    screen: { ...(fp.payload?.screen ?? {}) },
    media_devices: { audio_input_count: 1, audio_output_count: 1, video_input_count: 1 },
    geolocation: { mode: "auto" },
    noise: {
      canvas: { enabled: true, seed: 0 }, webgl: { enabled: true, seed: 0, intensity: 0.3 },
      audio: { enabled: true, seed: 0 }, client_rects: { enabled: false, seed: 0, max_offset: 0 },
      sensors: { enabled: false, seed: 0 }, fonts: { enabled: false, seed: 0 },
    },
    blocked_ports: [3389, 5900, 5901, 5800, 7070, 6568, 5938, 1080, 8080, 3128, 3030],
  };
}

function testSnapshot(entry: ProxyEntry, previous?: ProxyTestSnapshot): ProxyTestSnapshot {
  const dead = !entry.host || entry.name.toLowerCase().includes("expired");
  const isShard = entry.kind === "socks5" && entry.host.includes("proxyshard");
  const base = 30 + Math.round(Math.random() * 120);
  return {
    // The backend stamps "@<unix seconds>", as it does everywhere.
    first_seen: previous?.first_seen ?? nowStamp(),
    last_seen: nowStamp(),
    ip: dead ? "" : previous?.ip || `${45 + (base % 100)}.${base}.${(base * 3) % 255}.${(base * 7) % 250 + 1}`,
    country_code: dead ? "" : entry.country || "US",
    country: dead ? "" : previous?.country || entry.country || "United States",
    region: dead ? "" : previous?.region || "",
    city: dead ? "" : previous?.city || "",
    isp: dead ? "" : previous?.isp || "Unknown ISP",
    timezone: dead ? "" : previous?.timezone || "UTC",
    latitude: dead ? 0 : previous?.latitude ?? 0,
    longitude: dead ? 0 : previous?.longitude ?? 0,
    tcp_ms: dead ? null : base,
    udp_ms: dead ? null : isShard ? base + 14 : null,
    udp_error: dead ? null : isShard ? null : "SOCKS5 UDP ASSOCIATE refused",
    geo_error: dead ? "connect timed out after 8000 ms" : null,
    provider: "ip-api.com",
  };
}

/** `host:port`, `host:port:user:pass`, `user:pass@host:port`, `socks5://user:pass@host:port`. */
function parseProxyLines(text: string, kind: ProxyEntry["kind"]): ProxyEntry[] {
  const out: ProxyEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let k = kind;
    let rest = line;
    const scheme = /^(socks5|https?):\/\//i.exec(rest);
    if (scheme) { k = scheme[1].toLowerCase() as ProxyEntry["kind"]; rest = rest.slice(scheme[0].length); }
    let host = "", port = 0, username = "", password = "";
    if (rest.includes("@")) {
      const [auth, hp] = rest.split("@");
      [username, password = ""] = auth.split(":");
      [host, port] = [hp.split(":")[0], Number(hp.split(":")[1])];
    } else {
      const parts = rest.split(":");
      host = parts[0]; port = Number(parts[1]); username = parts[2] ?? ""; password = parts[3] ?? "";
    }
    if (!host || !Number.isFinite(port)) continue;
    // An id from the parse, as the backend's (proxy.rs `parse_one`): the save keeps it.
    out.push({ id: `px-${newId().slice(0, 6)}`, name: `${host}:${port}`, kind: k, host, port, username, password, country: "", notes: "" });
  }
  return out;
}

/// As the backend's `bulk_save` (proxy.rs `add_new`): each entry keeps its
/// id, and one identical to a stored proxy or to an earlier entry (same
/// kind, host, port, user and password) is skipped. Another password is
/// another proxy. Returns how many were added.
function addProxies(entries: ProxyEntry[], ctx: Ctx): number {
  let n = 0;
  for (const e of entries) {
    const same = ctx.state.proxies.some((p) => p.kind === e.kind && p.host === e.host && p.port === e.port && p.username === e.username && p.password === e.password);
    if (same) continue;
    handlers.proxy_save({ entry: { ...e, id: e.id && !ctx.state.proxies.some((p) => p.id === e.id) ? e.id : "" } }, ctx);
    n++;
  }
  return n;
}

/** What each module was allowed to call, kept for the session. */
const moduleGrants: Record<string, { modules: string[]; flows: string[] }> = {};
const runs: Record<string, RunState> = {};
const runTimers: Record<string, ReturnType<typeof setInterval>> = {};

function startRun(state: MockState, project: Project, ctx: Ctx): RunState {
  const ids = state.order.slice(0, Math.max(1, project.run.threads));
  const run: RunState = {
    project_id: project.id,
    project_name: project.name,
    started_at: Math.floor(Date.now() / 1000),
    running: true,
    workers: ids.map((id) => ({
      profile_id: id, profile_name: state.profiles[id]?.name ?? id, pass: 1, step: 0,
      steps_total: project.blocks.length, status: "starting", note: "opening the browser",
    })),
    log: [`${new Date().toLocaleTimeString()} run started, ${ids.length} worker(s)`],
  };
  runs[project.id] = run;
  for (const id of ids) startProcess(state, id);
  runTimers[project.id] = setInterval(() => {
    let live = false;
    for (const w of run.workers) {
      if (w.status === "done" || w.status === "failed" || w.status === "stopped") continue;
      live = true;
      w.status = "running";
      w.step += 1;
      w.note = project.blocks[w.step - 1]?.label ?? "";
      run.log.push(`${new Date().toLocaleTimeString()} ${w.profile_name}: step ${w.step}/${w.steps_total} ${w.note}`);
      if (w.step >= w.steps_total) {
        if (project.run.loops === 0 || w.pass < project.run.loops) { w.pass += 1; w.step = 0; }
        else { w.status = "done"; w.note = "finished"; stopProcess(state, w.profile_id); }
      }
    }
    if (!live) { run.running = false; clearInterval(runTimers[project.id]); delete runTimers[project.id]; }
    ctx.save();
  }, 2500);
  return run;
}

function stopRun(state: MockState, id: string): void {
  const run = runs[id];
  if (!run) return;
  run.running = false;
  for (const w of run.workers) { if (w.status !== "done") { w.status = "stopped"; w.note = "stopped by operator"; } stopProcess(state, w.profile_id); }
  run.log.push(`${new Date().toLocaleTimeString()} run stopped`);
  if (runTimers[id]) { clearInterval(runTimers[id]); delete runTimers[id]; }
}

/** Set `window.__shardxMockEngine` to see the engine screen: "offline" fails
 *  with a network error; "missing" downloads the engine and the fingerprint
 *  library, as on a fresh install; "update" has an engine and offers a newer
 *  one. Read on every call, so a test can switch it between tries.
 *  `window.__shardxMockEngineStepMs` slows each progress step (150 ms). */
const engineMode = () => (window as { __shardxMockEngine?: string }).__shardxMockEngine;
const engineOffline = () => engineMode() === "offline";
let engineDownloaded = false;
const engineInstalled = () => engineDownloaded || (engineMode() !== "offline" && engineMode() !== "missing");
const engineStepMs = () => Number((window as { __shardxMockEngineStepMs?: number }).__shardxMockEngineStepMs ?? 150);

const DATA_ROOT = "/Users/you/Library/Application Support/com.proxyshard.shardx";

/** Whether two stored profiles have the same content, `_meta` aside (key order too). */
function sameConfig(a: StoredProfile, b: StoredProfile): boolean {
  const norm = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(norm)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])]))
        : v;
  const body = (p: StoredProfile) => { const { _meta: _, ...rest } = p; return JSON.stringify(norm(rest)); };
  return body(a) === body(b);
}

/** The price of an order in cents, as user-api calculates it. The promo code
 *  "INVALID" is one it does not know (the way the app shows such an error). */
function psPrice(product: string, quantity: number, promoCode: unknown) {
  const promo = typeof promoCode === "string" ? promoCode.trim() : "";
  if (/^invalid$/i.test(promo)) throw "400 Bad Request: promo code not found";
  const unit = /premium/i.test(product) ? 1400 : /unlimited/i.test(product) ? 9900 : /standart/i.test(product) ? 700 : /isp/i.test(product) ? 390 : /mobile/i.test(product) ? 4500 : 180;
  const original = unit * Math.max(1, quantity);
  const discount = promo ? 15 : quantity >= 10 ? 10 : 0;
  const final = Math.round(original * (1 - discount / 100));
  return { original_price: original, final_price: final, discount_percent: discount, addons_price: 0, total_with_addons: final };
}

/** What Delete all data would move, as app_reset_plan answers. The stamp
 *  is UTC, so a test's frozen clock gives the same path everywhere. */
function resetPlan(state: MockState) {
  const counts = {
    profiles: Object.keys(state.profiles).length, proxies: state.proxies.length,
    fingerprints: state.fingerprints.filter((f) => !f.builtin).length, extensions: state.extensions.length,
    bookmarks: state.bookmarks.length, projects: state.automation.length,
  };
  const stamp = new Date().toISOString().slice(0, 19).replace("T", "-").replace(/:/g, "");
  return {
    id: `${stamp}.${Object.values(counts).join("-")}`,
    backups: [`${DATA_ROOT.replace(/\/[^/]+$/, "")}/shardx-launcher-backup-${stamp}`],
    counts,
    total_bytes: counts.profiles * 48 * 1024 * 1024 + counts.extensions * 1_200_000,
    entries: [`${DATA_ROOT}/profiles`, `${DATA_ROOT}/settings.json`],
  };
}

/** The state as a reset leaves it: the user's data gone to the backups, the
 *  bundled fingerprints and the defaults left. */
function emptyAfterReset(s: MockState, backups: string[]) {
  const fresh = seed();
  Object.assign(s, {
    profiles: {}, order: [], proxies: [], snapshots: {}, extensions: [], bookmarks: [], trash: [],
    trashed: {}, trashedAt: {}, fingerprints: s.fingerprints.filter((f) => f.builtin),
    settings: fresh.settings, api: fresh.api, psKey: "", psOrders: [], automation: [], modules: [], running: {},
    backup: backups[0],
  });
  delete s.psBalance;
}

export const handlers: Record<string, Handler> = {
  // ---- runtime, host, launcher ---------------------------------------------
  runtime_status: () => ({
    installed: engineInstalled(), binary_path: `${DATA_ROOT}/engine/ShardX.app`, installed_browser_etag: "e2f22d25", remote_browser_etag: "e2f22d25",
    update_available: engineMode() === "update" && !engineDownloaded, spec: { browser: { key: "ShardX-Mac-arm64.zip", label: "macOS (Apple Silicon)" }, widevine: null },
    fingerprints_installed: engineInstalled(), needs_newer_launcher: false, min_launcher_version: "2.0.1", launcher_version: "2.0.3",
  }),
  runtime_install: async (_a, ctx) => {
    if (engineOffline()) {
      ctx.emit("runtime:progress", { label: "ShardX-Mac-arm64.zip", phase: "download", received: 0, total: 2e7, percent: 0 });
      throw "Could not reach the download server.";
    }
    for (let i = 1; i <= 4; i++) { await sleep(engineStepMs()); ctx.emit("runtime:progress", { label: "ShardX-Mac-arm64.zip", phase: i < 4 ? "download" : "extract", received: i * 5e6, total: 2e7, percent: i * 25 }); }
    engineDownloaded = true;
    ctx.emit("runtime:done");
    return handlers.runtime_status({}, ctx);
  },
  launcher_update_check: () => ({ current: "2.0.3", latest: "2.0.3", update_available: false, release_url: "https://github.com/ProxyShard/ShardBrowser/releases/latest" }),
  host_platform: () => hostPlatform(),
  host_screen: () => [window.screen.width, window.screen.height],
  read_text_file: () => "",
  // The window's answer to a quit request (B48); recorded in __shardxMock.calls.
  app_quit_asking: () => null,
  app_quit_confirmed: () => null,
  app_quit_cancelled: () => null,
  clipboard_write: ({ text }) => {
    // Recorded for tests: headless browsers refuse the real clipboard.
    (window as { __shardxMockClipboard?: string }).__shardxMockClipboard = String(text ?? "");
    void navigator.clipboard?.writeText(String(text ?? "")).catch(() => {});
    return null;
  },
  clipboard_read: async () => {
    // What a test (or an earlier clipboard_write) put there: headless browsers refuse the real clipboard.
    const held = (window as { __shardxMockClipboard?: string }).__shardxMockClipboard;
    if (held !== undefined) return held;
    try { return await navigator.clipboard.readText(); } catch { return ""; }
  },

  // ---- settings, api, data root ---------------------------------------------
  settings_get: (_a, { state }) => state.settings,
  settings_save: ({ value }, ctx) => {
    // Recorded for tests: what the settings page sent.
    ((window as { __shardxMockSettingsSaves?: unknown[] }).__shardxMockSettingsSaves ??= []).push(value);
    // As the backend (lib.rs:1804-1808): an incoming signing key wins; a
    // missing or empty one keeps the key on disk.
    const keep = ctx.state.settings.api_secret;
    ctx.state.settings = { ...ctx.state.settings, ...value, api_secret: value.api_secret || keep };
    ctx.state.api = { ...ctx.state.api, enabled: !!value.api_enabled, port: value.api_port ?? ctx.state.api.port, base_url: `http://127.0.0.1:${value.api_port ?? ctx.state.api.port}` };
    ctx.save();
    return null;
  },
  // A test sets `__shardxMockSettingsLoadError` to show the load-error card.
  settings_load_error: () => (window as { __shardxMockSettingsLoadError?: string }).__shardxMockSettingsLoadError ?? null,
  api_info: (_a, { state }) => state.api,
  api_regenerate_token: (_a, ctx) => {
    // As the backend: a new signing key on disk, and a token signed with it.
    ctx.state.settings = { ...ctx.state.settings, api_secret: `mock-signing-key-${newId()}${newId()}` };
    ctx.state.api = { ...ctx.state.api, token: `shx_${newId()}${newId()}${newId()}${newId()}` };
    ctx.save();
    return ctx.state.api;
  },
  mcp_download: ({ dir }) => `${dir}/shardx-mcp`,
  data_root_get: () => ({ path: DATA_ROOT, custom: false, migrating: false }),
  // Settings > Storage > Delete all data (reset.rs). The plan counts what
  // would move; its id changes with any count, as the backend's digest does.
  // The reset moves everything aside (here: empties the state and remembers
  // the backups), keeping the engine and the bundled fingerprints. The app
  // then waits for app_restart; here the page reloads, onto an empty install.
  app_reset_plan: (_a, { state }) => resetPlan(state),
  app_reset: async ({ planId }, ctx) => {
    await sleep(300);
    const shown = resetPlan(ctx.state);
    if (planId !== shown.id) throw "Your data changed. Check again.";
    for (const id of Object.keys(runs)) stopRun(ctx.state, id);
    emptyAfterReset(ctx.state, shown.backups);
    ctx.save();
    return { backups: shown.backups };
  },
  app_reset_backup: (_a, { state }) => state.backup ?? null,
  app_reset_keep_storage: () => null,
  // A reset that did not finish: a test sets `state.resetPending` and reloads.
  app_reset_pending: (_a, { state }) => state.resetPending ?? null,
  app_reset_undo: async (_a, ctx) => { await sleep(200); delete ctx.state.resetPending; ctx.save(); return null; },
  // The journal renamed aside: the app unlocks, nothing else changes.
  app_reset_set_aside: (_a, ctx) => { delete ctx.state.resetPending; ctx.save(); return null; },
  app_reset_finish: async (_a, ctx) => {
    await sleep(200);
    const backups = ctx.state.resetPending?.backups ?? [];
    emptyAfterReset(ctx.state, backups);
    delete ctx.state.resetPending;
    ctx.save();
    return { backups };
  },
  // The window's keys were just cleared, this mock's own state among them:
  // written again, so the reload finds the emptied install.
  app_restart: (_a, ctx) => { ctx.save(); return null; },
  data_root_migrate: async ({ path }, ctx) => {
    const phases = ["scan", "copy", "copy", "copy", "verify", "cleanup", "done"] as const;
    let i = 0;
    for (const phase of phases) { await sleep(300); i++; ctx.emit("data-migration", { phase, done: i * 120, total: 840, percent: Math.round((i / phases.length) * 100), current: `${path}/profiles/${i}` }); }
    return 840;
  },

  // ---- profiles ---------------------------------------------------------------
  profile_list: (_a, { state }) => state.order.map((id) => metaOf(state.profiles[id])),
  profile_get: ({ id }, { state }) => profile(state, id),
  profile_save: ({ payload }, ctx) => {
    // `window.__shardxMockSaveFails = true` makes saves fail as a full disk would.
    if ((window as { __shardxMockSaveFails?: boolean }).__shardxMockSaveFails) throw "No space left on device (os error 28)";
    const { state } = ctx;
    const incoming = payload as StoredProfile;
    const id: string = incoming?._meta?.id || newId();
    const prev = state.profiles[id];
    // As the backend (lib.rs `enrich_new_config`, `randomize_hardware`): a
    // profile the UI creates gets new cores and memory, whatever it sent.
    const nav = (incoming as { navigator?: { hardware_concurrency?: number; device_memory?: number } }).navigator;
    if (!incoming?._meta?.id && nav) {
      nav.hardware_concurrency = nav.hardware_concurrency === 4 ? 8 : 4;
      nav.device_memory = nav.device_memory === 8 ? 16 : 8;
    }
    // As the backend: a save that carries the rev it was opened at is checked
    // against the stored one (0 for a profile that is gone).
    const sent = incoming?._meta?.id ? incoming._meta.rev : undefined;
    const onDisk = prev?._meta.rev ?? 0;
    if (typeof sent === "number" && sent !== onDisk) {
      throw `This profile changed after you opened it (rev ${onDisk}, you have ${sent}) — probably through the API or another window. Reopen it and apply your changes to the current version.`;
    }
    const meta = {
      ...(prev?._meta ?? { pinned: false, folder: "", total_runtime_ms: 0, created_at: nowStamp(), last_launched_at: null }),
      ...incoming._meta,
      id,
      // Only a change to the profile's own content moves the counter.
      rev: !prev ? 1 : sameConfig(prev, incoming) ? prev._meta.rev : prev._meta.rev + 1,
      last_launched_at: prev?._meta.last_launched_at ?? null,
      created_at: prev?._meta.created_at ?? nowStamp(),
      total_runtime_ms: prev?._meta.total_runtime_ms ?? 0,
      pinned: prev?._meta.pinned ?? false,
      folder: prev?._meta.folder ?? "",
    };
    state.profiles[id] = { ...incoming, _meta: meta };
    if (!prev) state.order.push(id);
    // The backend signals "store-changed" only for API writes; the UI reloads
    // after its own saves as it needs to.
    ctx.save();
    return metaOf(state.profiles[id]);
  },
  profile_delete: ({ id }, ctx) => {
    const { state } = ctx;
    const p = profile(state, id);
    stopProcess(state, id);
    (state.trashed ??= {})[id] = structuredClone(p);
    // As the backend (trash.rs RETENTION_DAYS): seven days.
    state.trash.unshift({ id, name: p.name, folder: p._meta.folder, deleted_at: Math.floor(Date.now() / 1000), expires_at: Math.floor(Date.now() / 1000) + 7 * 86400, size_bytes: 40_000_000 + Math.round(Math.random() * 150_000_000) });
    delete state.profiles[id];
    (state.trashedAt ??= {})[id] = state.order.indexOf(id);
    state.order = state.order.filter((x) => x !== id);
    // As the backend: store-changed is for API writes only.
    ctx.save();
    return null;
  },
  profile_clone: ({ id }, ctx) => {
    const src = profile(ctx.state, id);
    const copy = cloneProfile(src, `${src.name} (copy)`);
    ctx.state.profiles[copy._meta.id] = copy;
    ctx.state.order.splice(ctx.state.order.indexOf(id) + 1, 0, copy._meta.id);
    // As the backend: store-changed is for API writes only.
    ctx.save();
    return metaOf(copy);
  },
  profile_set_pin: ({ id, pinned }, ctx) => { profile(ctx.state, id)._meta.pinned = !!pinned; ctx.save(); return null; },
  profile_set_folder: ({ id, folder }, ctx) => { profile(ctx.state, id)._meta.folder = folder ?? ""; ctx.save(); return null; },
  profile_bind_proxy: ({ profileId, proxyId }, ctx) => { profile(ctx.state, profileId)._meta.proxy_id = proxyId ?? null; ctx.save(); return null; },
  profile_import: ({ payloads }, ctx) => {
    let n = 0;
    for (const p of payloads as StoredProfile[]) {
      const id = newId();
      ctx.state.profiles[id] = { ...p, _meta: { ...(p._meta ?? {}), id, rev: 1, created_at: nowStamp(), last_launched_at: null, total_runtime_ms: 0, pinned: false, folder: p._meta?.folder ?? "", proxy_id: p._meta?.proxy_id ?? null, gpu_preset_id: p._meta?.gpu_preset_id ?? "", extensions: p._meta?.extensions ?? [] } };
      ctx.state.order.push(id); n++;
    }
    // As the backend: store-changed is for API writes only.
    ctx.save();
    return n;
  },
  profile_create_from_template: ({ templateId }, ctx) => {
    const fp = ctx.state.fingerprints.find((f) => f.id === templateId);
    if (!fp) throw `template ${templateId} not in library`;
    const n = ctx.state.order.length + 1;
    const p = profileFromFingerprint(fp, `Profile#${n}`);
    ctx.state.profiles[p._meta.id] = p;
    ctx.state.order.push(p._meta.id);
    // As the backend: store-changed is for API writes only.
    ctx.save();
    return metaOf(p);
  },
  process_list: (_a, { state }) => Object.entries(state.running).map(([profile_id, r]) => ({ profile_id, pid: r.pid, uptime_ms: Date.now() - r.started })),
  process_kill: ({ profileId }, ctx) => { const ok = stopProcess(ctx.state, profileId); ctx.save(); return ok; },
  launch: async ({ profileId }, ctx) => {
    // What the engine starts with is read now, as the backend does: recorded for tests.
    const w = window as { __shardxMockLaunches?: { id: string; proxy_id: string | null }[] };
    (w.__shardxMockLaunches ??= []).push({ id: String(profileId), proxy_id: profile(ctx.state, String(profileId))._meta.proxy_id });
    // `launch_cancel` (below, B49) ends the launch with a "cancelled" error, at any moment of it.
    const cancels = (window as { __shardxMockLaunchCancelled?: string[] }).__shardxMockLaunchCancelled ??= [];
    const cancelled = () => {
      const at = cancels.indexOf(String(profileId));
      if (at < 0) return false;
      cancels.splice(at, 1);
      return true;
    };
    if (cancelled()) throw "Launch cancelled";
    for (let waited = 0; waited < 900; waited += 50) {
      await sleep(50);
      if (cancelled()) throw "Launch cancelled";
    }
    // `window.__shardxMockLaunchFails = [ids]`, set before load, makes those launches fail.
    if (((window as { __shardxMockLaunchFails?: string[] }).__shardxMockLaunchFails ?? []).includes(String(profileId))) {
      throw "Engine could not start: port in use";
    }
    const pid = startProcess(ctx.state, profileId); ctx.save(); return pid;
  },
  // Backend B49. `window.__shardxMockLaunchCancel` picks how the backend answers: unset, it has no
  // such command (Tauri rejects an unknown one, as the real backend does today); "now", it ends the
  // pending launch; "late", it answers only once the launch has gone through (too late to end it).
  launch_cancel: async ({ profileId }, ctx) => {
    const mode = (window as { __shardxMockLaunchCancel?: string }).__shardxMockLaunchCancel;
    if (!mode) throw "Command launch_cancel not found";
    if (mode === "late") {
      while (!ctx.state.running[String(profileId)]) await sleep(20);
      return null;
    }
    ((window as { __shardxMockLaunchCancelled?: string[] }).__shardxMockLaunchCancelled ??= []).push(String(profileId));
    return null;
  },
  sync_launch: async ({ profileIds, group }, ctx) => { await sleep(700); for (const id of profileIds) startProcess(ctx.state, id); ctx.save(); return group || `group-${newId().slice(0, 4)}`; },
  sync_status: ({ group }, { state }) => ({ group, members: Object.keys(state.running).map((profile, i) => ({ profile, excluded: false, driving: i === 0 })), paused: false }),
  sync_set_paused: () => null,
  sync_arrange: () => null,
  sync_stop: (_a, ctx) => { for (const id of Object.keys(ctx.state.running)) stopProcess(ctx.state, id); ctx.save(); return null; },
  sync_set_excluded: () => null,
  sync_close_panel: () => null,
  helper_profiles: () => [],
  helper_fields: () => null,
  helper_fill: () => 0,
  helper_show: () => null,
  helper_close: () => null,
  helper_dismiss: () => null,
  folder_rename: ({ old, new: next }, ctx) => {
    let n = 0;
    for (const id of ctx.state.order) {
      const p = ctx.state.profiles[id];
      if (p._meta.folder === old) { p._meta.folder = String(next); n++; }
    }
    ctx.save();
    return n;
  },
  folder_delete: ({ folder, deleteProfiles }, ctx) => {
    const ids = ctx.state.order.filter((id) => ctx.state.profiles[id]._meta.folder === folder);
    for (const id of ids) { if (deleteProfiles) handlers.profile_delete({ id }, ctx); else ctx.state.profiles[id]._meta.folder = ""; }
    // As the backend: store-changed is for API writes only.
    ctx.save();
    return ids.length;
  },
  cookies_export_to_file: () => 42,
  cookies_import: ({ cookies }) => (Array.isArray(cookies) ? cookies.length : 0),
  enrich_picks_for_preset: ({ presetId }, { state }) => {
    const nav = state.fingerprints.find((f) => f.id === presetId)?.payload?.navigator ?? {};
    return { hardware_concurrency: nav.hardware_concurrency, device_memory: nav.device_memory, platform_version: nav.platform_version };
  },

  // ---- proxies ------------------------------------------------------------------
  proxy_list: (_a, { state }) => state.proxies,
  proxy_save: ({ entry }, ctx) => {
    const e = { ...(entry as ProxyEntry) };
    if (!e.id) { e.id = `px-${newId().slice(0, 6)}`; ctx.state.proxies.push(e); }
    else { const i = ctx.state.proxies.findIndex((p) => p.id === e.id); if (i >= 0) ctx.state.proxies[i] = e; else ctx.state.proxies.push(e); }
    // As the backend: "store-changed" is for API writes only.
    ctx.save();
    return e;
  },
  proxy_delete: ({ id }, ctx) => {
    ctx.state.proxies = ctx.state.proxies.filter((p) => p.id !== id);
    delete ctx.state.snapshots[id];
    // As the backend (proxy.rs:116-126): profiles keep the id of a proxy that
    // is gone. The UI must show that and refuse to start them (A4, backend B1).
    ctx.save();
    return null;
  },
  proxy_full_test: async ({ entry }, ctx) => {
    // `window.__shardxMockTestMs = ms` sets how long a test takes (tests of many results).
    const testMs = (window as { __shardxMockTestMs?: number }).__shardxMockTestMs;
    await sleep(testMs ?? 600 + Math.random() * 900);
    const e = entry as ProxyEntry;
    // What each test ran against, for tests.
    const w = window as { __shardxMockTests?: { id: string; host: string }[] };
    (w.__shardxMockTests ??= []).push({ id: e.id, host: e.host });
    const hist = ctx.state.snapshots[e.id] ?? [];
    const snap = testSnapshot(e, hist[hist.length - 1]);
    if (e.id) { ctx.state.snapshots[e.id] = [...hist, snap].slice(-20); ctx.save(); }
    // As the backend: a test fills in an empty country on the stored proxy.
    const stored = ctx.state.proxies.find((p) => p.id === e.id);
    if (stored && snap.country_code && (!stored.country || stored.country === "—")) { stored.country = snap.country_code; ctx.save(); }
    if (snap.geo_error) throw snap.geo_error;
    return snap;
  },
  proxy_last_test: ({ id }, { state }) => { const h = state.snapshots[id]; return h?.length ? h[h.length - 1] : null; },
  proxy_history: ({ id }, { state }) => state.snapshots[id] ?? [],
  proxy_bulk_parse: ({ text, kind }) => parseProxyLines(String(text ?? ""), kind),
  proxy_bulk_save: ({ entries }, ctx) => addProxies(entries as ProxyEntry[], ctx),
  proxy_bulk_import: ({ text, kind }, ctx) => addProxies(parseProxyLines(String(text ?? ""), kind), ctx),

  // ---- fingerprints -----------------------------------------------------------
  // The library ships with the engine: empty until the first-run download.
  fingerprint_list: (_a, { state }) => (engineInstalled() ? state.fingerprints : []),
  fingerprint_delete: ({ id }, ctx) => { ctx.state.fingerprints = ctx.state.fingerprints.filter((f) => f.id !== id); ctx.save(); return null; },
  fingerprint_import: ({ jsonText, idHint }, ctx) => {
    let payload: any;
    try { payload = JSON.parse(String(jsonText)); } catch { throw "not valid JSON"; }
    const ua = String(payload?.navigator?.user_agent ?? "");
    const platform = String(payload?.navigator?.platform ?? (/Windows/.test(ua) ? "Win32" : /Mac/.test(ua) ? "MacIntel" : "Linux x86_64"));
    const entry: FingerprintEntry = {
      id: idHint || `fp-${newId().slice(0, 6)}`,
      label: payload?.name || idHint || `Imported ${new Date().toLocaleDateString()}`,
      platform,
      chrome: (/Chrome\/([\d.]+)/.exec(ua)?.[1]) ?? "152.0.0.0",
      gpu: String(payload?.webgl?.renderer ?? "unknown GPU"),
      tag_color: "#64748b",
      builtin: false,
      payload,
    };
    ctx.state.fingerprints.push(entry);
    ctx.save();
    return entry;
  },
  fingerprint_dir: () => `${DATA_ROOT}/fingerprints`,
  gpu_caps: () => ({ renderer: "ANGLE (Apple, Apple M3 Pro, OpenGL 4.1)", vendor: "Google Inc. (Apple)", webgl1: ["ANGLE_instanced_arrays", "EXT_color_buffer_half_float", "OES_texture_float"], webgl2: ["EXT_color_buffer_float", "OES_texture_float_linear"], engine_version: "152.0.7977.65" }),
  gpu_caps_compat: (_a, { state }) => {
    const out: Record<string, unknown> = {};
    for (const f of state.fingerprints) {
      const incompatible = f.id === "win11-arc-a770" || f.id === "linux-nvidia-1660";
      out[f.id] = { compatible: !incompatible, missing_webgl1: incompatible ? ["WEBGL_compressed_texture_s3tc_srgb"] : [], missing_webgl2: incompatible ? ["EXT_texture_compression_bptc"] : [], missing_webgpu: incompatible ? ["texture-compression-bc"] : [], profile_renderer: f.gpu };
    }
    return out;
  },

  // ---- extensions, bookmarks, trash -------------------------------------------
  extension_list: (_a, { state }) => state.extensions,
  extension_import: ({ paths }, ctx) => {
    const added = (paths as string[]).map((path) => ({ id: `ext-${newId().slice(0, 6)}`, name: path.split("/").pop()?.replace(/\.(crx|zip)$/, "") || "Extension", version: "1.0.0", description: "Imported from disk.", icon: "", path, size_bytes: 500_000 + Math.round(Math.random() * 5e6), added_at: `@${Math.floor(Date.now() / 1000)}` }));
    ctx.state.extensions.push(...added); changed(ctx, "extensions"); return added;
  },
  extension_import_url: ({ url }, ctx) => {
    const id = /[a-p]{32}/.exec(String(url))?.[0]?.slice(0, 8) ?? newId();
    const e = { id: `ext-${id}`, name: `Web Store ${id.slice(0, 4)}`, version: "3.2.1", description: `Downloaded from ${url}`, icon: "", path: `${DATA_ROOT}/extensions/${id}`, size_bytes: 1_200_000, added_at: `@${Math.floor(Date.now() / 1000)}` };
    ctx.state.extensions.push(e); changed(ctx, "extensions"); return e;
  },
  extension_delete: ({ id }, ctx) => { ctx.state.extensions = ctx.state.extensions.filter((e) => e.id !== id); for (const p of Object.values(ctx.state.profiles)) p._meta.extensions = p._meta.extensions.filter((x) => x !== id); changed(ctx, "extensions"); return null; },
  bookmark_list: (_a, { state }) => state.bookmarks,
  bookmark_save: ({ entry }, ctx) => { const b = { ...entry }; if (!b.id) { b.id = `bm-${newId().slice(0, 6)}`; ctx.state.bookmarks.push(b); } else { const i = ctx.state.bookmarks.findIndex((x) => x.id === b.id); if (i >= 0) ctx.state.bookmarks[i] = b; else ctx.state.bookmarks.push(b); } ctx.save(); return b; },
  bookmark_delete: ({ id }, ctx) => { ctx.state.bookmarks = ctx.state.bookmarks.filter((b) => b.id !== id); ctx.save(); return null; },
  trash_list: (_a, { state }) => state.trash,
  trash_restore: ({ id }, ctx) => {
    const t = ctx.state.trash.find((x) => x.id === id);
    if (!t) throw `nothing in the trash with id ${id}`;
    // As the backend unpacks the archive: the profile as it went in. Seeded
    // entries have no archive here and get rebuilt from a fingerprint.
    let p = ctx.state.trashed?.[id];
    if (!p) {
      p = profileFromFingerprint(ctx.state.fingerprints[0], t.name, t.folder);
      p._meta.id = id;
    }
    ctx.state.profiles[id] = p;
    // Back where it stood, as the backend lists it (by creation date).
    const at = ctx.state.trashedAt?.[id];
    if (at === undefined || at < 0) ctx.state.order.push(id);
    else ctx.state.order.splice(Math.min(at, ctx.state.order.length), 0, id);
    delete ctx.state.trashedAt?.[id];
    delete ctx.state.trashed?.[id];
    ctx.state.trash = ctx.state.trash.filter((x) => x.id !== id);
    // As the backend: store-changed is for API writes only.
    ctx.save();
    return metaOf(p);
  },
  trash_purge: ({ id }, ctx) => { ctx.state.trash = ctx.state.trash.filter((x) => x.id !== id); delete ctx.state.trashed?.[id]; delete ctx.state.trashedAt?.[id]; ctx.save(); return null; },
  trash_empty: (_a, ctx) => { const n = ctx.state.trash.length; ctx.state.trash = []; ctx.state.trashed = {}; ctx.state.trashedAt = {}; ctx.save(); return n; },

  // ---- ProxyShard account -----------------------------------------------------
  ps_get_key: (_a, { state }) => state.psKey,
  // No trial in the mock: the offer is the server's call, and inventing one
  // here would put a modal on every screenshot of the Proxies page.
  // What the site API answers about a trial. A test sets
  // `window.__shardxMockTrialOffer` before the page asks; unset, no offer is
  // going, which is what a developer should see.
  ps_trial_offer: async () => (window as { __shardxMockTrialOffer?: unknown }).__shardxMockTrialOffer ?? { show: false },
  ps_set_key: ({ key }, ctx) => { ctx.state.psKey = String(key ?? ""); ctx.save(); return null; },
  ps_me: async (_a, { state }) => { await sleep(400); if (!state.psKey) throw "401 Unauthorized: API key missing"; if (!state.psKey.startsWith("psk_")) throw "401 Unauthorized: key rejected by user-api.proxyshard.com"; return { ...PS_ME, wallet_balance: state.psBalance ?? PS_ME.wallet_balance, active_orders: state.psOrders.filter((o) => o.expires_at && Date.parse(o.expires_at) > Date.now()).length }; },
  ps_orders: ({ status = "all", offset = 0, limit = 20 }, { state }) => {
    const active = (o: { expires_at: string | null }) => !!o.expires_at && Date.parse(o.expires_at) > Date.now();
    const all = state.psOrders.filter((o) => status === "all" ? true : status === "active" ? active(o) : status === "cancelled" ? !active(o) : false);
    const page = all.slice(offset, offset + limit);
    return { orders: page, next: offset + limit < all.length ? `/orders?offset=${offset + limit}` : null, total: all.length };
  },
  ps_order: ({ id }, { state }) => { const o = state.psOrders.find((x) => x.order_id === id); if (!o) throw `order ${id} not found`; return { order: { ...o, proxies_count: (PS_ACTIVE[id] ?? []).length, slots: { avail: 5, used: (PS_ACTIVE[id] ?? []).length } } }; },
  ps_renew: async ({ id }, ctx) => { await sleep(500); const o = ctx.state.psOrders.find((x) => x.order_id === id); if (!o) throw `order ${id} not found`; const d = new Date(Math.max(Date.now(), o.expires_at ? Date.parse(o.expires_at) : Date.now())); d.setMonth(d.getMonth() + 1); o.expires_at = d.toISOString(); ctx.save(); return null; },
  ps_products: () => ({ products: PS_PRODUCTS }),
  ps_calculate: ({ product, quantity = 1, promoCode }) => psPrice(String(product), quantity, promoCode),
  ps_purchase: async ({ body }, ctx) => {
    await sleep(900);
    const id = 42000 + ctx.state.psOrders.length;
    const d = new Date(); d.setMonth(d.getMonth() + 1);
    // As the account: the order is charged to the wallet.
    const price = psPrice(String(body?.product ?? "Datacenter USA"), Number(body?.quantity ?? 1), body?.promo_code);
    ctx.state.psBalance = (ctx.state.psBalance ?? PS_ME.wallet_balance) - price.final_price;
    ctx.state.psOrders.unshift({ order_id: id, product_name: String(body?.product ?? "Datacenter USA"), cycle_name: String(body?.cycle ?? "monthly"), expires_at: d.toISOString(), auto_renewal: false, tag: null });
    ctx.save();
    return { ok: true, order_id: id };
  },
  ps_available_count: () => PS_AVAILABLE,
  ps_active: ({ orderId }, { state }) => ({ data: PS_ACTIVE[orderId] ?? [], order_tag: state.psOrders.find((o) => o.order_id === orderId)?.tag ?? "none" }),
  ps_signature_set: ({ orderId, items }) => { for (const it of items as { ip: string; signature: string }[]) { const row = (PS_ACTIVE[orderId] ?? []).find((r) => r.ip === it.ip); if (row) row.signature = it.signature || null; } return null; },
  ps_set_tag: ({ id, tag }, ctx) => { const o = ctx.state.psOrders.find((x) => x.order_id === id); if (o) o.tag = tag; ctx.save(); return null; },
  ps_add_bandwidth: async () => { await sleep(500); return null; },
  // `window.__shardxMockTraffic = { premium: { data, data_remain, data_spent } }`,
  // set before load, replaces a tier's traffic (a plan running low).
  ps_profile_traffic: ({ proxyType }) =>
    (window as { __shardxMockTraffic?: Record<string, unknown> }).__shardxMockTraffic?.[String(proxyType)]
    ?? PS_TRAFFIC[String(proxyType)] ?? PS_TRAFFIC.premium,
  // Backend B40. `window.__shardxMockUsage = null`, set before load, is an
  // account with no history (every card shows the No data ghost).
  ps_usage: async ({ range }) => {
    await sleep(250);
    const o = (window as { __shardxMockUsage?: unknown }).__shardxMockUsage;
    if (o === null) throw "ps_usage: no history";
    return o ?? psUsage(String(range));
  },
  ps_countries: () => ({ results: PS_COUNTRIES }),
  ps_regions: ({ countryCode }) => ({ results: PS_REGIONS[String(countryCode).toUpperCase()] ?? [] }),
  ps_cities: ({ regionCode }) => ({ results: PS_CITIES[String(regionCode)] ?? [] }),
  ps_resi_isps: () => ({ results: PS_ISPS }),

  // ---- automation ---------------------------------------------------------------
  automation_available: () => true,
  automation_list: (_a, { state }) => state.automation,
  automation_create: ({ name }, ctx) => {
    const p: Project = { id: `proj-${newId().slice(0, 6)}`, name: String(name || "Untitled"), notes: "", blocks: [], run: { threads: 1, loops: 1, hours: 0, profiles: [], start: "" }, rules: [], created_at: Math.floor(Date.now() / 1000), updated_at: Math.floor(Date.now() / 1000) };
    ctx.state.automation.push(p); ctx.save(); return p;
  },
  automation_save: ({ project }, ctx) => { const p = { ...(project as Project), updated_at: Math.floor(Date.now() / 1000) }; const i = ctx.state.automation.findIndex((x) => x.id === p.id); if (i >= 0) ctx.state.automation[i] = p; else ctx.state.automation.push(p); ctx.save(); return p; },
  automation_delete: ({ id }, ctx) => { stopRun(ctx.state, id); ctx.state.automation = ctx.state.automation.filter((p) => p.id !== id); ctx.save(); return null; },
  automation_duplicate: ({ id }, ctx) => { const src = ctx.state.automation.find((p) => p.id === id); if (!src) throw `project ${id} not found`; const copy: Project = JSON.parse(JSON.stringify(src)); copy.id = `proj-${newId().slice(0, 6)}`; copy.name = `${src.name} copy`; copy.created_at = copy.updated_at = Math.floor(Date.now() / 1000); ctx.state.automation.push(copy); ctx.save(); return copy; },
  automation_attach: () => null,
  automation_detach: () => null,
  automation_attached: () => false,
  automation_screencast: () => null,
  automation_call: ({ method }) => { if (method === "Traffic.list") return { rulesJson: "[]" }; if (method === "Traffic.mount") return { ruleSetId: `rs-${newId().slice(0, 4)}` }; if (method === "Script.run") return { result: "null" }; return {}; },
  automation_launch: async ({ profileId }, ctx) => { await sleep(700); const pid = startProcess(ctx.state, profileId); ctx.save(); return pid; },
  automation_pick: ({ x, y }) => ({ selector: "button.primary", tag: "button", label: "Continue", x, y, tried: ["#submit (not found)", "text=Continue (2 matches)"] }),
  automation_run: ({ projectId }, ctx) => { const p = ctx.state.automation.find((x) => x.id === projectId); if (!p) throw `project ${projectId} not found`; if (p.blocks.length === 0) throw "the project has no steps"; startRun(ctx.state, p, ctx); ctx.save(); return null; },
  automation_run_stop: ({ projectId }, ctx) => { stopRun(ctx.state, projectId); ctx.save(); return null; },
  automation_run_status: ({ projectId }) => runs[projectId] ?? null,
  automation_fleet: () => Object.values(runs),
  automation_fleet_window: () => null,
  automation_tls_fingerprints: () => ["chrome_152", "chrome_131", "chrome_120", "firefox_128", "safari_17"],
  automation_modules: (_a, { state }) => state.modules,
  automation_module_permissions: ({ id }) => ({ asks: { modules: [], flows: (window as { __shardxMockAsks?: { flows: string[] } }).__shardxMockAsks?.flows ?? ["*"], vars: ["rows", "sheet"], reason: `${id} needs to read the run variables it appends` }, granted: { decided_for: id, call_modules: moduleGrants[id]?.modules ?? [], call_flows: moduleGrants[id]?.flows ?? [] } }),
  automation_module_grant: ({ id, modules, flows }) => { moduleGrants[id] = { modules: modules as string[], flows: flows as string[] }; return null; },
  automation_module_install: ({ path }, ctx) => { const m: ModuleInfo = { id: `mod-${newId().slice(0, 4)}`, name: String(path).split("/").pop()?.replace(/\.wasm$/, "") || "module", path: String(path), error: "", blocks: [{ kind: "custom.step", label: "Custom step", about: "From an installed module.", params: [{ name: "input", label: "Input", kind: "text" }] }] }; ctx.state.modules.push(m); ctx.save(); return m; },
  automation_module_remove: ({ id }, ctx) => { ctx.state.modules = ctx.state.modules.filter((m) => m.id !== id); ctx.save(); return null; },
  automation_modules_dir: () => `${DATA_ROOT}/modules`,
  automation_export: ({ projectId }, { state }) => { const p = state.automation.find((x) => x.id === projectId); if (!p) throw `project ${projectId} not found`; return { format: 1, exported_at: Math.floor(Date.now() / 1000), project: p, modules: [], needs: p.blocks.filter((b) => b.secrets.length).map((b) => ({ block_id: b.id, label: b.label, params: b.secrets })) }; },
  automation_import: ({ bundle }, ctx) => { const p: Project = JSON.parse(JSON.stringify(bundle.project)); p.id = `proj-${newId().slice(0, 6)}`; ctx.state.automation.push(p); ctx.save(); return p; },
  automation_display: () => ({ server: hostPlatform() === "macOS" ? "quartz" : "x11", limited: false, note: "", browser_placement: true, panels: true }),

  // ---- Tauri plugins ------------------------------------------------------------
  "plugin:app|version": () => "2.0.3",
  "plugin:app|name": () => "ShardBrowser Launcher",
  "plugin:app|tauri_version": () => "2.5.0",
  "plugin:dialog|open": ({ options }) => {
    const o = options ?? {};
    if (o.directory) return o.multiple ? ["/Users/you/Desktop/ShardX-data"] : "/Users/you/Desktop/ShardX-data";
    const file = o.filters?.[0]?.extensions?.[0] ? `export.${o.filters[0].extensions[0]}` : "profile.json";
    return o.multiple ? [`/Users/you/Downloads/${file}`] : `/Users/you/Downloads/${file}`;
  },
  "plugin:dialog|save": ({ options }) => `/Users/you/Downloads/${options?.defaultPath ?? "export.json"}`,
  "plugin:dialog|message": () => null,
  "plugin:opener|open_url": ({ url }) => { window.open(String(url), "_blank", "noopener"); return null; },
  "plugin:opener|open_path": ({ path }) => { console.info("[mock] open path", path); return null; },
  "plugin:opener|reveal_item_in_dir": ({ paths }) => { console.info("[mock] reveal", paths); return null; },
};
