import { Button, Tooltip, type ButtonSize } from "@proxyshard/shardx-ui-kit";
import { AddIcon } from "../../../shared/icons";
import { keyWorksOn } from "../../../shared/commands";
import { useNav } from "../../../shared/model/navigation";
import { capOf, command, labelOf } from "../../commands";
import { openProfileForm } from "../../profile-form/model/useProfileForm";

/// Opens the profile form on a new profile (a library fingerprint for this
/// machine's OS, the current Folder, no proxy unless `proxyId` names one):
/// nothing exists until Create profile. Its words and its key (C) are the registry's
/// New profile, as the palette and the sheet print them (UI-29); the key
/// shows only on a page where C works (Profiles). `size` and `mode` are for
/// the setup checklist, where only the current step's button is the filled
/// one (CRAFT-20); every other place passes neither.
export function NewProfileButton({ proxyId = null, size = "xsmall", mode = "filled" }: {
  proxyId?: string | null;
  size?: ButtonSize;
  mode?: "filled" | "stroke";
} = {}) {
  const section = useNav((s) => s.section);
  const label = labelOf("profile.new");
  const cmd = command("profile.new");
  return (
    <Tooltip content={label} shortcut={keyWorksOn(cmd, section) ? capOf(cmd) : undefined}>
      <Button
        variant={mode === "filled" ? "primary" : "neutral"} mode={mode} size={size} data-mode={mode}
        data-tour="new-profile"
        leftIcon={<AddIcon className="size-3.5" />}
        onClick={() => openProfileForm({ mode: "create", proxyId })}
      >
        {label}
      </Button>
    </Tooltip>
  );
}
