import { useEffect, useRef, useState } from "react";
import { DialogModal } from "@proxyshard/shardx-ui-kit";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "../../../shared/model/toast";
import { useT } from "../../../shared/i18n";
import { psTrialOffer, usePsAccount } from "../../../entities/proxyshard";

/// The trial offer, on the Proxies page, for someone who has not connected a
/// ProxyShard account yet.
///
/// Everything about the offer comes from the public site API — whether there
/// is one at all, how much traffic it is for, and the link to claim it. The
/// server weighs who is asking before it answers, so nothing is decided here
/// and no amount or address sits in this file. A campaign ends by the server
/// saying no, not by an update.
///
/// Asked once a run: on the first time the Proxies page is opened after the
/// app starts, and only while no key is connected. A second visit in the same
/// run is silent, and the next start asks again until a key is saved.

type Offer = { url: string; gb: number };

/** One ask per run of the app: the page mounts again on every visit, these do
 *  not. `pending` holds the one request, so a second mount reads the answer
 *  already on its way instead of asking again — which is also what keeps the
 *  dialog working under React's double-invoked effects, where the first run's
 *  cleanup has already fired by the time the answer lands. `shown` closes the
 *  question for the rest of the run once it has been put. */
let pending: Promise<Offer | null> | null = null;
let shownThisRun = false;

/** Only http(s) ever reaches the opener. */
function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

/** The one request of the run. Nothing to show and nothing reachable read the
 *  same here: no network, no server and no offer are all silence, and an
 *  offer that cannot be fetched is not one to tell the operator about. */
function offerOnce(): Promise<Offer | null> {
  pending ??= psTrialOffer()
    .then((data: any) => {
      if (data?.show !== true) return null;
      const url = safeUrl(data?.url);
      const gb = typeof data?.trial_gb === "number" && data.trial_gb > 0 ? data.trial_gb : 0;
      return url && gb ? { url, gb } : null;
    })
    .catch(() => null);
  return pending;
}

/** The account holds gigabytes, so 0.1 is the 100 MB the offer is spoken of as. */
function sizeOf(gb: number): { amount: number; unit: "mb" | "gb" } {
  return gb < 1
    ? { amount: Math.round(gb * 1000), unit: "mb" }
    : { amount: Math.round(gb * 10) / 10, unit: "gb" };
}

export function PsTrialModal() {
  const t = useT();
  const key = usePsAccount((s) => s.key);
  const keyLoaded = usePsAccount((s) => s.keyLoaded);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // `key` is null until it has been read from disk; "" means there is none.
    if (!keyLoaded || key || shownThisRun) return;
    let live = true;
    offerOnce().then((o) => {
      if (!live || !o || shownThisRun) return;
      shownThisRun = true;
      setOffer(o);
      setOpen(true);
    });
    return () => { live = false; };
  }, [key, keyLoaded]);

  if (!offer) return null;
  const { amount, unit } = sizeOf(offer.gb);
  // Both named outright: the key is checked by reading this file, and a key
  // built from a variable reads as one nothing calls.
  const size = unit === "mb"
    ? t("psTrial.sizeMb", { n: amount })
    : t("psTrial.sizeGb", { n: amount });

  return (
    <DialogModal
      open={open}
      onClose={() => setOpen(false)}
      size="sm"
      // A dialog with no field puts the keyboard on its confirm, as the
      // welcome and the save prompts do: Enter already submits the form, and
      // the ring belongs on the button Enter presses.
      confirmRef={confirmRef}
      initialFocusRef={confirmRef}
      title={t("psTrial.title", { size })}
      subtitle={
        <>
          {t("psTrial.body", { size })}
          {/* The footer note is for a reason the confirm cannot proceed; this
              is an aside about the page, so it stays in the body. */}
          <span className="mt-2 block">{t("psTrial.note")}</span>
        </>
      }
      confirmLabel={t("psTrial.confirm")}
      cancelLabel={t("psTrial.cancel")}
      onConfirm={() => {
        setOpen(false);
        openUrl(offer.url).catch(() => toast.err(t("psTrial.openFailed")));
      }}
    />
  );
}
