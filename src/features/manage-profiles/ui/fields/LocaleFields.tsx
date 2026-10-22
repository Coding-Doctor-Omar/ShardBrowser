import { SelectField } from "../../../../shared/ui/SelectField";
import { AUTO_LANG, AUTO_TZ, LOCALES, TIMEZONES } from "../../../../shared/constants";
import { useT } from "../../../../shared/i18n";
import type { FieldProps } from "./types";

export function LocaleFields({ f, u }: FieldProps) {
  const t = useT();
  return (
    <div className="grid grid-cols-2 gap-[12px]">
      <div className="flex flex-col gap-1">
        <SelectField
          value={f.timezone}
          label={t("inlineEditor.timezoneLabel")}
          onChange={(v) => u("timezone", v)}
          options={TIMEZONES.map((tz) => ({
            value: tz,
            label: tz === AUTO_TZ ? t("inlineEditor.timezoneAuto") : tz,
          }))}
        />
      </div>
      <div className="flex flex-col gap-1">
        <SelectField
          label={t("inlineEditor.languageLabel")}
          value={f.language}
          onChange={(v) => u("language", v)}
          options={LOCALES.map((l) => ({
            value: l.code,
            // Every other entry is the language's own name for itself.
            label: l.code === AUTO_LANG ? t("inlineEditor.languageAuto") : l.label,
          }))}
        />
      </div>
    </div>
  );
}
