import { telegramAuth, ping, grantAdmin } from './api/auth.js';
import { saveSession, deleteSession } from './api/sessions.js';
import { createStore, loadState, USER_ROLES } from './state/store.js';
import { createId, getDefaultSessionName, ensureActiveBowl, computeSummary } from './domain/session.js';
import { MAX_COST_DIGITS, MAX_COST_VALUE } from './ui/shared.js';
import { renderSessionPane } from './ui/sessionPane.js';
import { renderPeoplePane } from './ui/peoplePane.js';
import { renderSettingsPane } from './ui/settingsPane.js';
import { renderHistoryPane } from './ui/historyPane.js';

const store = createStore();
let backendOnline = false;

function getInitDataRaw() {
  const tg = window.Telegram?.WebApp;
  if (tg?.initData && tg.initData.includes('hash=')) return tg.initData;
  const h = typeof location !== 'undefined' ? (location.hash || '') : '';
  const m = h.match(/(?:^|[&#])tgWebAppData=([^&]+)/);
  if (m) {
    try { const raw = decodeURIComponent(m[1]); if (raw.includes('hash=')) return raw; } catch {}
    if (m[1].includes('hash=')) return m[1];
  }
  return '';
}

window.tg = window.Telegram?.WebApp || null;
try { window.tg?.ready?.(); } catch {}
window.initDataRaw = (typeof window !== 'undefined') ? (getInitDataRaw() || '') : '';

export function applyTheme(choice) {
  const mode = choice === 'dark' ? 'dark' : choice === 'light' ? 'light' : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', mode);
  document.body?.setAttribute('data-theme', mode);
}

async function initTelegramAuth() {
  try {
    await new Promise((r) => setTimeout(r, 30));
    const initData = window.initDataRaw || getInitDataRaw();
    if (!initData || !initData.includes('hash=')) return;
    await telegramAuth(initData);
  } catch (err) { console.warn('[auth] error:', err); }
}

function getTgUser() { return window.tg?.initDataUnsafe?.user || null; }
function getTgPersonFromUser(user) { if (!user?.id) return null; return { id: String(user.id), name: user.username || user.first_name || 'Пользователь' }; }

export class HookahSpliterApp {
  constructor() {
    this.state = loadState();
    this.state.settings = this.state.settings || {};
    if (!('theme' in this.state.settings)) this.state.settings.theme = 'system';
    if (!this.state.historyFilters) this.state.historyFilters = { searchTerm: '', date: '', sortBy: 'date' };
    if (!this.state.historyView) this.state.historyView = 'history';
    applyTheme(this.state.settings.theme);

    this.elements = {
      sessionPane: document.getElementById('sessionPane'),
      peoplePane: document.getElementById('peoplePane'),
      settingsPane: document.getElementById('settingsPane'),
      historyPane: document.getElementById('historyPane'),
    };

    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (this.state.settings.theme === 'system') applyTheme('system');
      });
    }

    this.renderAll();
  }

  saveState(state) { store.saveState(state); }
  applyTheme(choice) { applyTheme(choice); }
  persistAndRender() { this.saveState(this.state); this.renderAll(); }
  isAdmin() { return this.state.role === USER_ROLES.ADMIN; }
  getPersonMap() { return new Map(this.state.people.map((person) => [person.id, person])); }
  ensureActiveBowl(session) { return ensureActiveBowl(session); }
  computeSummary(session) { return computeSummary(session, this.getPersonMap()); }

  showValidationMessage(element, message) {
    if (!element) return window.alert?.(message);
    element.setCustomValidity(message); element.reportValidity(); window.setTimeout(() => element.setCustomValidity(''), 0);
  }

  validateCostValue(rawValue, inputElement) {
    const trimmed = String(rawValue ?? '').trim();
    if (!trimmed || !/^\d+$/.test(trimmed)) return this.showValidationMessage(inputElement, 'Можно вводить только цифры без пробелов и символов.'), null;
    if (trimmed.length > MAX_COST_DIGITS) return this.showValidationMessage(inputElement, `Стоимость не может содержать более ${MAX_COST_DIGITS} цифр (максимум ${MAX_COST_VALUE}).`), null;
    const numericValue = Number(trimmed);
    if (!Number.isFinite(numericValue) || numericValue <= 0 || numericValue > MAX_COST_VALUE) return this.showValidationMessage(inputElement, `Стоимость не может превышать ${MAX_COST_VALUE}.`), null;
    return numericValue;
  }

  enforceCostInputConstraints(inputElement) {
    if (!inputElement) return;
    const raw = String(inputElement.value ?? '');
    const digitsOnly = raw.replace(/\D+/g, '');
    let sanitized = digitsOnly;
    if (sanitized.length > MAX_COST_DIGITS) sanitized = sanitized.slice(0, MAX_COST_DIGITS);
    if (sanitized !== raw) inputElement.value = sanitized;
  }

  setupCostInput(inputElement, initialValue, commitCallback) {
    if (!inputElement) return;
    inputElement.dataset.lastValidValue = initialValue == null ? '' : String(initialValue);
    inputElement.addEventListener('input', (event) => this.enforceCostInputConstraints(event.target));
    inputElement.addEventListener('blur', (event) => {
      const target = event.target;
      const ok = commitCallback?.(target);
      if (ok === false) target.value = target.dataset.lastValidValue ?? '';
      else target.dataset.lastValidValue = target.value;
    });
  }

  renderAll() { renderSessionPane(this); renderPeoplePane(this); renderSettingsPane(this); renderHistoryPane(this); }

  startSession(name) {
    const trimmed = (name || '').trim() || getDefaultSessionName();
    const firstBowlId = createId();
    this.state.currentSession = { id: createId(), name: trimmed, startedAt: new Date().toISOString(), endedAt: null, isActive: true, bowls: [{ id: firstBowlId, name: 'Чаша 1', cost: this.state.settings.defaultBowlCost, participantIds: [] }], activeBowlId: firstBowlId };
    this.persistAndRender();
  }

  async endSession() {
    const session = this.state.currentSession;
    if (!session || !session.isActive) return;
    const endedAt = new Date().toISOString();
    const summary = this.computeSummary(session);
    const totalCost = session.bowls.reduce((s, b) => s + (Number(b.cost) || 0), 0);
    await saveSession({ id: session.id, title: session.name, startedAt: session.startedAt, endedAt, people: this.state.people, bowls: session.bowls, totalCost, summary: summary.rows });
    const personMap = this.getPersonMap();
    this.state.savedSessions.unshift({
      id: session.id, name: session.name, startedAt: session.startedAt, endedAt,
      bowlCount: session.bowls.length, totalCost, summary: summary.rows,
      bowls: session.bowls.map((b) => ({ name: b.name, cost: b.cost, participants: b.participantIds.map((id) => personMap.get(id)?.name).filter(Boolean) })),
    });
    session.isActive = false; session.endedAt = endedAt; this.persistAndRender();
  }

  async deleteSavedSession(sessionId) {
    if (!this.isAdmin()) return;
    const response = await deleteSession(sessionId);
    if (!response.ok) return;
    this.state.savedSessions = this.state.savedSessions.filter((session) => session.id !== sessionId);
    this.persistAndRender();
  }

  addBowl() { const s = this.state.currentSession; if (!s?.isActive) return; const prev = this.ensureActiveBowl(s); const id = createId(); s.bowls.push({ id, name: `Чаша ${s.bowls.length + 1}`, cost: this.state.settings.defaultBowlCost, participantIds: prev ? [...prev.participantIds] : [] }); s.activeBowlId = id; this.persistAndRender(); }
  selectBowl(bowlId) { const s = this.state.currentSession; if (!s?.isActive) return; s.activeBowlId = bowlId; this.persistAndRender(); }
  updateSessionName(name) { const s = this.state.currentSession; if (!s?.isActive) return; s.name = (name || '').trim() || s.name || getDefaultSessionName(); this.persistAndRender(); }
  updateBowlName(bowlId, name) { const s = this.state.currentSession; if (!s?.isActive) return; const b = s.bowls.find((i) => i.id === bowlId); if (!b) return; b.name = (name || '').trim() || b.name || 'Чаша'; this.persistAndRender(); }
  updateBowlCost(bowlId, costValue, inputElement) { if (!this.isAdmin()) return false; const b = this.state.currentSession?.bowls.find((i) => i.id === bowlId); if (!b) return false; const value = this.validateCostValue(costValue, inputElement); if (value === null) return false; b.cost = value; this.persistAndRender(); return true; }
  removeParticipant(personId) { const bowl = this.ensureActiveBowl(this.state.currentSession); if (!bowl) return; bowl.participantIds = bowl.participantIds.filter((id) => id !== personId); this.persistAndRender(); }
  quickAddParticipant(personId) { if (!this.isAdmin()) return; const bowl = this.ensureActiveBowl(this.state.currentSession); if (!bowl || bowl.participantIds.includes(personId)) return; bowl.participantIds.push(personId); this.persistAndRender(); }
  updateDefaultBowlCost(costValue, inputElement) { if (!this.isAdmin()) return false; const value = this.validateCostValue(costValue, inputElement); if (value === null) return false; this.state.settings.defaultBowlCost = value; this.persistAndRender(); return true; }

  async grantAdminRole(rawUserId, inputElement) {
    if (!this.isAdmin()) return;
    const userId = String(rawUserId || '').trim();
    if (!/^\d+$/.test(userId)) return this.showValidationMessage(inputElement, 'Telegram ID должен содержать только цифры.');
    const response = await grantAdmin(userId);
    if (!response.ok) return this.showValidationMessage(inputElement, 'Не удалось выдать права администратора.');
    if (inputElement) inputElement.value = '';
    window.alert?.('Права администратора успешно выданы.');
  }

  addParticipantByName(name, { source = 'manual' } = {}) {
    if (!this.isAdmin() || source === 'manual') return;
    const bowl = this.ensureActiveBowl(this.state.currentSession);
    if (!this.state.currentSession?.isActive || !bowl) return;
    const trimmed = (name || '').trim(); if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    let person = this.state.people.find((p) => p.name.toLowerCase() === lower);
    if (!person) { person = { id: createId(), name: trimmed }; this.state.people.push(person); this.state.people.sort((a, b) => a.name.localeCompare(b.name, 'ru')); }
    if (!bowl.participantIds.includes(person.id)) bowl.participantIds.push(person.id);
    this.persistAndRender();
  }

  updatePersonName(personId, name) { const person = this.state.people.find((p) => p.id === personId); const trimmed = (name || '').trim(); if (!person || !trimmed) return; person.name = trimmed; this.state.people.sort((a, b) => a.name.localeCompare(b.name, 'ru')); this.persistAndRender(); }
  deletePerson(personId) { this.state.people = this.state.people.filter((p) => p.id !== personId); const s = this.state.currentSession; if (s) s.bowls.forEach((b) => { b.participantIds = b.participantIds.filter((id) => id !== personId); }); this.persistAndRender(); }
  addPersonFromPeopleTab(name, { source = 'manual' } = {}) { if (!this.isAdmin() || source === 'manual') return; const trimmed = (name || '').trim(); if (!trimmed) return; if (this.state.people.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) return; this.state.people.push({ id: createId(), name: trimmed }); this.state.people.sort((a, b) => a.name.localeCompare(b.name, 'ru')); this.persistAndRender(); }
}

export function ensureAuthorizedPersonInState() {
  const person = getTgPersonFromUser(getTgUser());
  if (!person) return;
  const state = loadState();
  const existing = state.people.find((item) => String(item.id) === person.id);
  if (!existing) state.people.push(person); else if (person.name && existing.name !== person.name) existing.name = person.name;
  state.people.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  store.saveStateLocalOnly(state);
}

export async function initUserHeader() {
  try { backendOnline = (await ping()).ok; } catch { backendOnline = false; }
  const avatar = document.querySelector('#tab-user .user-avatar');
  const handle = document.querySelector('#tab-user .user-handle');
  const fallback = document.querySelector('#tab-user .avatar-fallback');
  const user = getTgUser();
  if (handle) handle.textContent = backendOnline && user?.username ? `@${user.username}` : 'Гость';
  if (avatar) {
    if (backendOnline && user?.photo_url) { avatar.src = user.photo_url; avatar.hidden = false; }
    else { avatar.removeAttribute('src'); avatar.hidden = true; }
  }
  if (fallback) fallback.hidden = Boolean(avatar && !avatar.hidden);
}

export async function bootstrapApp() {
  await initTelegramAuth();
  await store.pullStateFromCloud();
  ensureAuthorizedPersonInState();
  window.app = new HookahSpliterApp();
  initUserHeader().catch(() => {});
}

export function flushStateToCloudKeepalive() { store.flushStateToCloudKeepalive(); }
