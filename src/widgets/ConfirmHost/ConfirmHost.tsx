import { Button, Modal, useLatched } from "@proxyshard/shardx-ui-kit";
import { useConfirmStore } from "../../shared/model/confirm";

/// Global confirm dialog — UI-kit Modal fed by the zustand confirm store.
export function ConfirmHost() {
  const req = useConfirmStore((s) => s.req);
  // The question stays on screen while the dialog leaves.
  const shown = useLatched(req);
  if (!shown) return null;
  const done = (v: unknown) => { if (req) req.resolve(v); };
  const danger = shown.buttons.some((b) => b.danger);
  return (
    <Modal
      open={req != null}
      onOpenChange={(o) => { if (!o) done(null); }}
      // A destructive or irreversible question is read with its consequence on open (A11Y-07).
      role={danger || shown.alert ? "alertdialog" : "dialog"}
      size="sm"
      title={shown.title}
      description={shown.message}
      footer={shown.buttons.map((b, i) => (
        <Button
          key={i}
          size="xsmall"
          variant={b.danger ? "error" : b.primary ? "primary" : "neutral"}
          mode={b.danger || b.primary ? "filled" : "stroke"}
          onClick={() => done(b.value)}
        >
          {b.label}
        </Button>
      ))}
    />
  );
}
