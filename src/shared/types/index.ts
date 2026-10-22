export const SECTIONS = [
  "profiles",
  "proxies",
  "proxyshard",
  "fingerprints",
  "extensions",
  "bookmarks",
  "automation",
  "trash",
  "settings",
] as const;
export type Section = (typeof SECTIONS)[number];

export type ToastKind = "ok" | "err" | "info" | "warn" | "progress";
/** A button on a toast that does the obvious next thing ("Assign a proxy"). */
/** `run` may return false to say it did nothing: the toast then stays (SH4). */
export type ToastAction = { label: string; run: () => void | boolean };
export type ToastItem = {
  id: number;
  kind: ToastKind;
  /** What happened, naming its subject: "Couldn't start “Sandbox”". */
  title: string;
  /** Why: the backend's words, second line, muted. */
  detail?: string;
  /** The object the toast is about (a profile name). */
  subject?: string;
  /** A next step; with `onUndo` it shows beside Undo ("Assign replacements…"). */
  action?: ToastAction;
  /** Puts back what the toast reports; shown as an Undo button (and Cmd/Ctrl+Z). */
  onUndo?: () => void;
  /** How many times this toast was raised. Never drawn: the announcer says a repeat again. */
  raised: number;
  progress?: { done: number; total: number };
  /** Dismissed: kept for its exit, then removed by the host. */
  leaving?: boolean;
};

export type ConfirmButton = { label: string; value: any; danger?: boolean; primary?: boolean };
export type ConfirmReq = {
  title: string;
  message: string;
  buttons: ConfirmButton[];
  /** Read as an alert with its consequence on open, though nothing is destroyed (a purchase). */
  alert?: boolean;
  resolve: (v: any) => void;
};


export type OsPlatform = "macOS" | "Windows" | "Linux";

export type IconProps = { size?: number; className?: string };

export type FieldProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  mono?: boolean;
  /** A password or key: see the kit Input's `secret`. */
  secret?: boolean;
  /** What is wrong with the value, under the field. */
  error?: string;
};


export type RtSpec = {
  browser: { key: string; label: string };
  widevine: { key: string; label: string } | null;
};
export type RtStatus = {
  installed: boolean;
  binary_path: string | null;
  installed_browser_etag: string | null;
  remote_browser_etag: string | null;
  update_available: boolean;
  spec: RtSpec | null;
  fingerprints_installed: boolean;
  /** The published engine wants a newer launcher; no engine update is offered. */
  needs_newer_launcher: boolean;
  min_launcher_version: string | null;
  launcher_version: string;
};
export type RtProgress = {
  label: string;
  phase: "download" | "extract";
  received: number;
  total: number;
  percent: number;
};
export type RtUpdate = {
  current: string;
  latest: string | null;
  update_available: boolean;
  release_url: string | null;
};
