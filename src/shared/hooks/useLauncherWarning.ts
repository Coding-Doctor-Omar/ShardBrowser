import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { t } from "../i18n";
import { toast } from "../model/toast";

/// The backend's two launch warnings, in the user's language with what to do
/// next; anything else keeps the backend's words under a translated title
/// (plan ruling 7). Like every toast they close on their own (a warning after
/// 8 s, longer once the pointer or the keyboard is on it).
const KNOWN_WARNINGS: ReadonlyArray<readonly [RegExp, string, string]> = [
  [/would not let the launcher send UDP/i, "launcherWarning.udpTitle", "launcherWarning.udpDetail"],
  [/could not read the proxy'?s location/i, "launcherWarning.geoTitle", "launcherWarning.geoDetail"],
];
function showLauncherWarning(text: string) {
  const known = KNOWN_WARNINGS.find(([re]) => re.test(text));
  if (known) toast.warn({ title: t(known[1]), detail: t(known[2]) });
  else toast.warn({ title: t("launcherWarning.title"), detail: text });
}

// Warnings the backend raises during a launch — a geo probe that failed and
// left the profile on UTC, say. stderr is not a place a user looks, so they
// arrive as a toast.
export function useLauncherWarning() {
  useEffect(() => {
    let disposed = false;
    let un: (() => void) | undefined;
    listen<string>("launcher-warning", (e) => showLauncherWarning(e.payload)).then((fn) => {
      if (disposed) fn();
      else un = fn;
    });
    return () => {
      disposed = true;
      un?.();
    };
  }, []);
}
