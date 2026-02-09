import { fetchState, updateState } from '../api/state.js';

export const STORAGE_KEY = 'hookahSpliterStateV2';
export const SYNC_DEBOUNCE_MS = 800;
export const USER_ROLES = Object.freeze({ ADMIN: 'admin', USER: 'user' });

export const createInitialState = () => ({
  settings: { defaultBowlCost: 500, theme: 'system' },
  people: [],
  currentSession: null,
  savedSessions: [],
  role: USER_ROLES.USER,
  historyFilters: { searchTerm: '', date: '', sortBy: 'date' },
  historyFiltersExpanded: false,
  historyView: 'history',
});

export function loadState() {
  if (typeof window === 'undefined') return createInitialState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    const parsed = JSON.parse(raw);
    return {
      settings: {
        defaultBowlCost: Number.isFinite(parsed?.settings?.defaultBowlCost) ? parsed.settings.defaultBowlCost : 500,
        theme: parsed?.settings?.theme || 'system',
      },
      people: Array.isArray(parsed.people) ? parsed.people : [],
      savedSessions: Array.isArray(parsed.savedSessions) ? parsed.savedSessions : [],
      currentSession: parsed.currentSession || null,
      role: parsed?.role === USER_ROLES.ADMIN ? USER_ROLES.ADMIN : USER_ROLES.USER,
      historyFilters: {
        searchTerm: parsed?.historyFilters?.searchTerm || '',
        date: parsed?.historyFilters?.date || '',
        sortBy: parsed?.historyFilters?.sortBy || 'date',
      },
      historyFiltersExpanded: typeof parsed?.historyFiltersExpanded === 'boolean' ? parsed.historyFiltersExpanded : false,
      historyView: parsed?.historyView === 'stats' ? 'stats' : 'history',
    };
  } catch (error) {
    console.warn('Не удалось прочитать сохранённое состояние', error);
    return createInitialState();
  }
}

export function createStore() {
  let clientRev = 0;
  let timer = null;

  const saveStateLocalOnly = (state) => {
    if (typeof window === 'undefined') return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { console.warn('saveState localStorage error:', e); }
  };

  const saveState = (state) => {
    saveStateLocalOnly(state);
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const r = await updateState(state, clientRev);
        if (r.status === 409) {
          const body = await r.json();
          clientRev = body.server?._rev || 0;
          saveStateLocalOnly(body.server);
          window.app?.renderAll?.();
        } else if (r.ok) {
          const body = await r.json();
          clientRev = body.state?._rev || clientRev;
        }
      } catch (e) { console.warn('pushState failed', e); }
    }, SYNC_DEBOUNCE_MS);
  };

  const pullStateFromCloud = async () => {
    try {
      const server = await fetchState();
      if (!server) return null;
      clientRev = server._rev || 0;
      const local = loadState() || {};
      const merged = {
        ...server,
        people: Array.isArray(server.people) ? server.people : (local.people || []),
        role: server.role === USER_ROLES.ADMIN ? USER_ROLES.ADMIN : USER_ROLES.USER,
      };
      saveStateLocalOnly(merged);
      return merged;
    } catch (e) { console.warn('pullStateFromCloud failed', e); }
    return null;
  };

  const flushStateToCloudKeepalive = () => {
    try {
      const s = loadState();
      updateState(s, clientRev, { keepalive: true }).catch(() => {});
    } catch {}
  };

  return { saveState, saveStateLocalOnly, pullStateFromCloud, flushStateToCloudKeepalive };
}
