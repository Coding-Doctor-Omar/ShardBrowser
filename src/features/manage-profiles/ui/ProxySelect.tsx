import { useMemo } from "react";
import { type ComboboxOption } from "@proxyshard/shardx-ui-kit";
import { duplicateLabels, proxyAddressHint, proxyLabel, type ProxyEntry } from "../../../entities/proxy";
import { useT } from "../../../shared/i18n";
import { ProxyFlag } from "../../../shared/ui/ProxyFlag";

/// The proxy choices every picker shows (TYPE-07): "No proxy" first, then
/// each proxy by its name with host:port kept whole as the hint, its flag (a
/// globe in the same slot when it has none, so the names line up), and its
/// host, country and type as words the search finds. A name more than one
/// proxy has gets `host:port, CC` as the hint so they can be told apart
/// (owner item 11). Built once per
/// list, not per render (PERF-15: 1,000 proxies); `t` changes only with the
/// language, which rebuilds the tree. A bound proxy that is gone (`value`
/// names no proxy) reads as missing, never as No proxy (IFACE-01).
export function useProxyOptions(proxies: ProxyEntry[], value?: string | null): ComboboxOption[] {
  const t = useT();
  return useMemo(() => {
    const shared = duplicateLabels(proxies);
    return [
      { value: "", label: t("proxySelect.directConnection") },
      ...(value && !proxies.some((p) => p.id === value)
        ? [{ value, label: t("profileRow.proxyMissing"), disabled: true }]
        : []),
      ...proxies.map((p) => {
        const label = proxyLabel(p);
        const isShared = shared.has(label);
        return {
          value: p.id,
          label,
          hint: isShared || label !== `${p.host}:${p.port}` ? proxyAddressHint(p, isShared) : undefined,
          keywords: [p.host, p.country ?? "", p.kind],
          icon: <ProxyFlag cc={p.country} height={14} />,
        };
      }),
    ];
  }, [proxies, value, t]);
}
