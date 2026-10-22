import { create } from "zustand";
import { LABEL_COLORS, type LabelColorId } from "../../../shared/constants";
import type { Tag } from "../model/types";

/// Tags and which profiles carry them. Kept by the app on this computer
/// (owner decision, Phase 4: frontend only), in the shape the backend should
/// store later: a registry of tags, and tag ids by profile id.
const KEY = "shardx.tags";
const VERSION = 1;
/** Longest tag name; a chip has to stay a chip. */
export const TAG_NAME_MAX = 32;

type Saved = { version: number; tags: Tag[]; byProfile: Record<string, string[]> };

const COLOR_IDS = LABEL_COLORS.map((c) => c.id) as readonly string[];

/** The color a new tag gets when none is chosen: the next palette color in
 *  turn. */
export function nextTagColor(tags: readonly Pick<Tag, "color">[]): LabelColorId {
  return COLOR_IDS[tags.length % COLOR_IDS.length] as LabelColorId;
}

/** A saved value, or nothing at all when it is missing, broken or of another version. */
function load(): Pick<Saved, "tags" | "byProfile"> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Saved> | null;
    if (!raw || raw.version !== VERSION || !Array.isArray(raw.tags)) return { tags: [], byProfile: {} };
    const tags = raw.tags.filter((t): t is Tag =>
      !!t && typeof t.id === "string" && typeof t.name === "string" && COLOR_IDS.includes(t.color));
    const known = new Set(tags.map((t) => t.id));
    const byProfile: Record<string, string[]> = {};
    for (const [pid, ids] of Object.entries(raw.byProfile ?? {})) {
      if (!Array.isArray(ids)) continue;
      const kept = ids.filter((id) => typeof id === "string" && known.has(id));
      if (kept.length) byProfile[pid] = [...new Set(kept)];
    }
    return { tags, byProfile };
  } catch {
    return { tags: [], byProfile: {} };
  }
}

function save(tags: Tag[], byProfile: Record<string, string[]>) {
  try { localStorage.setItem(KEY, JSON.stringify({ version: VERSION, tags, byProfile })); } catch { /* private mode */ }
}

/** Trims, collapses internal whitespace and caps the length: the one
 *  normaliser a tag name goes through (the TagPicker cleans its query the
 *  same way before it compares, PC-085). */
export const clean = (name: string) => name.trim().replace(/\s+/g, " ").slice(0, TAG_NAME_MAX);
const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();
/** Whether another tag than `exceptId` already has this name (any case). */
export const tagNameTaken = (tags: readonly Tag[], name: string, exceptId?: string) =>
  tags.some((t) => t.id !== exceptId && same(t.name, clean(name)));
const newId = () => `t-${Math.random().toString(36).slice(2, 10)}`;

export type TagStore = {
  tags: Tag[];
  byProfile: Record<string, string[]>;
  /** A new tag, or the one that already has this name (any case). Null for an empty name. */
  create: (name: string, color?: LabelColorId) => Tag | null;
  /** False when the name is empty or another tag has it. */
  rename: (id: string, name: string) => boolean;
  recolor: (id: string, color: LabelColorId) => void;
  /** Deletes the tag and takes it off every profile. */
  remove: (id: string) => void;
  /** Puts a deleted tag back with the profiles it was on (Undo), at its old place in the list. */
  restoreTag: (tag: Tag, byProfile: Record<string, string[]>, at?: number) => void;
  /** Gives the tag to every profile, or takes it off all when all have it. */
  toggle: (profileIds: string[], tagId: string) => void;
  /** Takes one tag off one profile. */
  untag: (profileId: string, tagId: string) => void;
  /** Gives one profile exactly these tags (the profile form's Save). */
  setTags: (profileId: string, tagIds: string[]) => void;
  /** Drops the tags of profiles deleted for good. */
  forgetProfiles: (profileIds: string[]) => void;
  /** A profile got another id (one being created got its real one): its tags follow. */
  moveProfile: (from: string, to: string) => void;
};

export const useTags = create<TagStore>((set, get) => {
  const commit = (tags: Tag[], byProfile: Record<string, string[]>) => {
    save(tags, byProfile);
    set({ tags, byProfile });
  };
  return {
    ...load(),
    create: (name, color) => {
      const n = clean(name);
      if (!n) return null;
      const existing = get().tags.find((t) => same(t.name, n));
      if (existing) return existing;
      const tag: Tag = { id: newId(), name: n, color: color ?? nextTagColor(get().tags) };
      commit([...get().tags, tag], get().byProfile);
      return tag;
    },
    rename: (id, name) => {
      const n = clean(name);
      if (!n || tagNameTaken(get().tags, n, id)) return false;
      commit(get().tags.map((t) => (t.id === id ? { ...t, name: n } : t)), get().byProfile);
      return true;
    },
    recolor: (id, color) => commit(get().tags.map((t) => (t.id === id ? { ...t, color } : t)), get().byProfile),
    remove: (id) => {
      const byProfile: Record<string, string[]> = {};
      for (const [pid, ids] of Object.entries(get().byProfile)) {
        const kept = ids.filter((x) => x !== id);
        if (kept.length) byProfile[pid] = kept;
      }
      commit(get().tags.filter((t) => t.id !== id), byProfile);
    },
    restoreTag: (tag, byProfile, at) => {
      const tags = [...get().tags];
      if (!tags.some((x) => x.id === tag.id)) tags.splice(at ?? tags.length, 0, tag);
      const merged = { ...get().byProfile };
      for (const [pid, ids] of Object.entries(byProfile)) if (ids.includes(tag.id)) merged[pid] = [...new Set([...(merged[pid] ?? []), tag.id])];
      commit(tags, merged);
    },
    toggle: (profileIds, tagId) => {
      const cur = get().byProfile;
      const all = profileIds.every((pid) => cur[pid]?.includes(tagId));
      const byProfile = { ...cur };
      for (const pid of profileIds) {
        const ids = cur[pid] ?? [];
        const next = all ? ids.filter((x) => x !== tagId) : ids.includes(tagId) ? ids : [...ids, tagId];
        if (next.length) byProfile[pid] = next; else delete byProfile[pid];
      }
      commit(get().tags, byProfile);
    },
    untag: (profileId, tagId) => {
      const ids = (get().byProfile[profileId] ?? []).filter((x) => x !== tagId);
      const byProfile = { ...get().byProfile };
      if (ids.length) byProfile[profileId] = ids; else delete byProfile[profileId];
      commit(get().tags, byProfile);
    },
    setTags: (profileId, tagIds) => {
      const known = new Set(get().tags.map((t) => t.id));
      const ids = [...new Set(tagIds)].filter((id) => known.has(id));
      const byProfile = { ...get().byProfile };
      if (ids.length) byProfile[profileId] = ids; else delete byProfile[profileId];
      commit(get().tags, byProfile);
    },
    forgetProfiles: (profileIds) => {
      const byProfile = { ...get().byProfile };
      for (const pid of profileIds) delete byProfile[pid];
      commit(get().tags, byProfile);
    },
    moveProfile: (from, to) => {
      const ids = get().byProfile[from];
      if (!ids) return;
      const byProfile = { ...get().byProfile };
      delete byProfile[from];
      byProfile[to] = [...new Set([...(byProfile[to] ?? []), ...ids])];
      commit(get().tags, byProfile);
    },
  };
});

/** The tags of one profile, in the registry's order. */
export function tagsOf(profileId: string, s: Pick<TagStore, "tags" | "byProfile"> = useTags.getState()): Tag[] {
  const ids = s.byProfile[profileId];
  if (!ids?.length) return [];
  return s.tags.filter((t) => ids.includes(t.id));
}

/** The tags of one profile, kept current. */
export function useProfileTags(profileId: string): Tag[] {
  const tags = useTags((s) => s.tags);
  const ids = useTags((s) => s.byProfile[profileId]);
  if (!ids?.length) return [];
  return tags.filter((t) => ids.includes(t.id));
}
