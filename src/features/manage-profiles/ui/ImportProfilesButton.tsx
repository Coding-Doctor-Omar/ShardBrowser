import { Button, Tooltip } from "@proxyshard/shardx-ui-kit";
import { DownloadIcon } from "../../../shared/icons";
import { useProfile } from "../../../entities/profile";
import { useT } from "../../../shared/i18n";

export function ImportProfilesButton() {
  const t = useT();
  const importFromClipboard = useProfile((s) => s.importFromClipboard);
  return (
    <Tooltip content={t("importProfilesButton.tooltip")}>
      <Button
        variant="neutral"
        mode="stroke"
        size="xsmall"
        leftIcon={<DownloadIcon className="size-3.5" />}
        onClick={importFromClipboard}
      >
        {t("importProfilesButton.label")}
      </Button>
    </Tooltip>
  );
}
