import { useMemo, useRef, useState } from "react";
import { FolderChip } from "../../../shared/ui/FolderChip";
import { PropertyButton, PropertyRow } from "../../../shared/ui/peek";
import { hasOwn } from "../../../shared/lib/utils";
import { useT } from "../../../shared/i18n";
import { useFolderMeta, useFolders } from "../../../entities/profile";
import { ComboPopover } from "./fields";

/// The profile form's Folder: a pick changes the form only, and a name no
/// Folder has yet is kept as typed. The profile moves, and a new Folder is
/// made, when the form is saved.
export function FolderField({ value, onChange }: { value: string; onChange: (folder: string) => void }) {
  const t = useT();
  const folders = useFolders();
  const metaByName = useFolderMeta((s) => s.byName);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const colorOf = (name: string) => (hasOwn(metaByName, name) ? metaByName[name].color : null);
  const options = useMemo(() => [
    { value: "", label: t("peek.noFolder") },
    // A new one typed here shows with the rest until the form is saved.
    ...[...folders, ...(value && !folders.includes(value) ? [value] : [])].map((name) => ({
      value: name,
      label: name,
      content: <FolderChip name={name} color={colorOf(name)} />,
    })),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- colorOf reads metaByName
  ], [folders, metaByName, value, t]);
  return (
    <PropertyRow id="folder" label={t("peek.folder")}>
      {(labelId) => (
        <>
          <PropertyButton ref={anchor} labelledBy={labelId} empty={!value} expanded={open} onClick={() => setOpen((v) => !v)}>
            {value ? <FolderChip name={value} color={colorOf(value)} /> : <span className="truncate">{t("peek.noFolder")}</span>}
          </PropertyButton>
          <ComboPopover
            open={open} onOpenChange={setOpen} anchorRef={anchor} label={t("peek.folder")} value={value}
            options={options}
            placeholder={t("folderPicker.find")}
            onChange={(v) => { if (v !== value) onChange(v); }}
            onCreate={(typed) => { const name = typed.trim(); if (name) onChange(name); }}
            createLabel={(name) => t("folderPicker.create", { name })}
          />
        </>
      )}
    </PropertyRow>
  );
}
