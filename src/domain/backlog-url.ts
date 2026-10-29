import { PLATFORMS, type Platform } from './enums';
import { BACKLOG_DIRECTIONS, BACKLOG_GROUPS, BACKLOG_SORTS, type BacklogDirection, type BacklogGroup, type BacklogSort } from './library-backlog';

/**
 * Backlog view state in the URL (#247): view, source, platform, PESTO, status, sort,
 * direction, group and page. Everything here is an enum value or an option label,
 * never post copy (SEC-10), so a view can be linked, reloaded and walked back to.
 * Search text deliberately stays out of the URL; it is remembered per tab instead.
 */
export type BacklogUrlState = {
  view: 'posts' | 'ideas';
  source?: string;
  platform?: Platform;
  pesto?: string;
  status?: string;
  sort?: BacklogSort;
  dir?: BacklogDirection;
  group?: BacklogGroup;
  page: number;
};

type Source = URLSearchParams | Record<string, string | string[] | undefined>;

function read(source: Source, key: string): string | undefined {
  if (source instanceof URLSearchParams) return source.get(key) ?? undefined;
  const value = source[key];
  return typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;
}

function oneOf<T extends string>(list: readonly string[], raw: string | undefined): T | undefined {
  return raw && list.includes(raw) ? (raw as T) : undefined;
}

const MAX_FREE = 120;
const free = (raw: string | undefined) => (raw && raw.length <= MAX_FREE ? raw : undefined);

export function parseBacklogUrl(source: Source): BacklogUrlState {
  const page = Number(read(source, 'page'));
  return {
    view: read(source, 'view') === 'ideas' ? 'ideas' : 'posts',
    source: free(read(source, 'source')),
    platform: oneOf<Platform>(PLATFORMS, read(source, 'platform')),
    pesto: free(read(source, 'pesto')),
    status: free(read(source, 'status')),
    sort: oneOf<BacklogSort>(BACKLOG_SORTS, read(source, 'sort')),
    dir: oneOf<BacklogDirection>(BACKLOG_DIRECTIONS, read(source, 'dir')),
    group: oneOf<BacklogGroup>(BACKLOG_GROUPS, read(source, 'group')),
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}

/** Defaults are omitted so the plain Backlog URL stays `/backlog`. Unrelated params in `base` are kept. */
export function serializeBacklogUrl(state: Partial<BacklogUrlState>, base: URLSearchParams = new URLSearchParams()): URLSearchParams {
  const out = new URLSearchParams(base.toString());
  for (const key of ['view', 'source', 'platform', 'pesto', 'status', 'sort', 'dir', 'group', 'page']) out.delete(key);
  if (state.view === 'ideas') out.set('view', 'ideas');
  for (const key of ['source', 'platform', 'pesto', 'status', 'sort', 'group'] as const) {
    const value = state[key];
    if (value) out.set(key, value);
  }
  if (state.dir === 'desc') out.set('dir', 'desc');
  if (state.page && state.page > 1) out.set('page', String(state.page));
  return out;
}
