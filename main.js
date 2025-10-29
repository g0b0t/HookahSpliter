const STORAGE_KEY = 'hookah-spliter-state-v1';

const defaultState = () => ({
  settings: {
    defaultBowlCost: 500,
  },
  savedParticipants: [],
  session: createNewSession(),
  ui: {
    activeTab: 'session',
  },
});

function createNewSession() {
  const createdAt = new Date();
  return {
    id: createdAt.toISOString(),
    title: `Вечер ${createdAt.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: 'long',
    })}`,
    createdAt: createdAt.toISOString(),
    bowls: [],
    activeBowlId: null,
  };
}

const state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (!parsed.session) {
      parsed.session = createNewSession();
    }
    if (!parsed.ui) {
      parsed.ui = { activeTab: 'session' };
    }
    return parsed;
  } catch (error) {
    console.warn('Не удалось загрузить состояние', error);
    return defaultState();
  }
}

function persistState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function pluralizeParticipants(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return `${count} участник`;
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} участника`;
  }
  return `${count} участников`;
}

function nextBowlNumber() {
  return (state.session.bowls.length || 0) + 1;
}

function setActiveTab(tab) {
  state.ui.activeTab = tab;
  persistState();
  renderApp();
}

function ensureActiveBowl() {
  if (state.session.activeBowlId) return;
  if (state.session.bowls.length === 0) {
    const bowl = createBowl();
    state.session.bowls.push(bowl);
    state.session.activeBowlId = bowl.id;
  } else {
    state.session.activeBowlId = state.session.bowls[state.session.bowls.length - 1].id;
  }
}

function createBowl({
  name,
  cost,
  participants = [],
} = {}) {
  const id = crypto.randomUUID();
  return {
    id,
    name: name || `Чаша #${nextBowlNumber()}`,
    cost: Number.isFinite(cost) && cost > 0 ? Math.round(cost) : state.settings.defaultBowlCost,
    participants,
    createdAt: new Date().toISOString(),
  };
}

function findBowl(id) {
  return state.session.bowls.find((b) => b.id === id) || null;
}

function getActiveBowl() {
  ensureActiveBowl();
  return findBowl(state.session.activeBowlId);
}

function upsertParticipant(name, comment = '') {
  const trimmedName = name.trim();
  if (!trimmedName) return null;
  let participant = state.savedParticipants.find((p) => p.name.toLowerCase() === trimmedName.toLowerCase());
  if (!participant) {
    participant = {
      id: crypto.randomUUID(),
      name: trimmedName,
      comment: comment.trim(),
      createdAt: new Date().toISOString(),
    };
    state.savedParticipants.push(participant);
  }
  return participant;
}

function addParticipantToActiveBowl(participantId) {
  const bowl = getActiveBowl();
  if (!bowl) return;
  if (!bowl.participants.includes(participantId)) {
    bowl.participants.push(participantId);
    persistState();
    renderApp();
  }
}

function removeParticipantFromBowl(bowlId, participantId) {
  const bowl = findBowl(bowlId);
  if (!bowl) return;
  bowl.participants = bowl.participants.filter((id) => id !== participantId);
  persistState();
  renderApp();
}

function addBowl({ name, cost, copyParticipants } = {}) {
  const baseParticipants = copyParticipants
    ? getActiveBowl()?.participants.slice() || []
    : [];
  const bowl = createBowl({ name, cost, participants: baseParticipants });
  state.session.bowls.push(bowl);
  state.session.activeBowlId = bowl.id;
  persistState();
  renderApp();
}

function setActiveBowl(bowlId) {
  state.session.activeBowlId = bowlId;
  persistState();
  renderApp();
}

function updateSettings({ defaultBowlCost }) {
  if (Number.isFinite(defaultBowlCost) && defaultBowlCost > 0) {
    state.settings.defaultBowlCost = Math.round(defaultBowlCost);
  }
  persistState();
  renderApp();
}

function resetSession() {
  if (!confirm('Начать новый вечер? Текущие данные будут очищены.')) {
    return;
  }
  state.session = createNewSession();
  persistState();
  renderApp();
}

function calculateSummary() {
  const participantMap = new Map();

  const getParticipantInfo = (id) =>
    state.savedParticipants.find((p) => p.id === id) || { id, name: 'Неизвестно' };

  state.session.bowls.forEach((bowl) => {
    if (bowl.participants.length === 0) return;
    const share = bowl.cost / bowl.participants.length;
    bowl.participants.forEach((participantId) => {
      const entry = participantMap.get(participantId) || {
        participant: getParticipantInfo(participantId),
        bowls: 0,
        total: 0,
      };
      entry.bowls += 1;
      entry.total += share;
      participantMap.set(participantId, entry);
    });
  });

  const totals = Array.from(participantMap.values()).map((entry) => ({
    participant: entry.participant,
    bowls: entry.bowls,
    total: Math.round(entry.total),
  }));

  totals.sort((a, b) => b.total - a.total);
  return {
    totals,
    bowls: state.session.bowls.map((bowl) => ({
      id: bowl.id,
      name: bowl.name,
      cost: bowl.cost,
      participants: bowl.participants.map((pid) => getParticipantInfo(pid)),
    })),
  };
}

function copySummaryToClipboard() {
  const summary = calculateSummary();
  if (summary.totals.length === 0) {
    alert('Нет данных для копирования');
    return;
  }
  const lines = [];
  lines.push(`${state.session.title}`);
  lines.push('Итоговый расчёт:');
  summary.totals.forEach(({ participant, bowls, total }) => {
    lines.push(`• ${participant.name}: ${total} ₽ (${bowls} чаш)`);
  });
  lines.push('—');
  summary.bowls.forEach((bowl, index) => {
    const participantNames = bowl.participants.length
      ? bowl.participants.map((p) => p.name).join(', ')
      : 'никто';
    lines.push(`${index + 1}. ${bowl.name} — ${bowl.cost} ₽ (${participantNames})`);
  });

  const text = lines.join('\n');
  navigator.clipboard
    .writeText(text)
    .then(() => alert('Результаты скопированы'))
    .catch(() => alert('Не удалось скопировать результаты'));
}

function formatDateTitle(isoString) {
  return new Date(isoString).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderApp() {
  ensureActiveBowl();
  const app = document.getElementById('app');
  app.innerHTML = '';

  const header = renderHeader();
  const tabs = renderTabs();
  app.append(header, tabs);

  const viewContainer = document.createElement('div');
  viewContainer.className = 'view-container';

  if (state.ui.activeTab === 'session') {
    viewContainer.append(renderSessionView());
  } else {
    viewContainer.append(renderSummaryView());
  }

  app.append(viewContainer);
}

function renderHeader() {
  const header = document.createElement('header');
  header.className = 'session-header';

  const left = document.createElement('div');
  left.className = 'session-header__left';
  const title = document.createElement('div');
  title.className = 'session-header__title';
  title.textContent = state.session.title || 'Вечер';
  const subtitle = document.createElement('div');
  subtitle.className = 'session-header__date';
  subtitle.textContent = formatDateTitle(state.session.createdAt);
  left.append(title, subtitle);

  const actions = document.createElement('div');
  actions.className = 'session-header__actions';

  const settingsButton = document.createElement('button');
  settingsButton.className = 'secondary';
  settingsButton.textContent = 'Настройки';
  settingsButton.addEventListener('click', () => openSettingsModal());

  const resetButton = document.createElement('button');
  resetButton.className = 'ghost';
  resetButton.textContent = 'Новый вечер';
  resetButton.addEventListener('click', resetSession);

  const finishButton = document.createElement('button');
  finishButton.className = 'primary';
  finishButton.textContent = 'Завершить сессию';
  finishButton.addEventListener('click', () => setActiveTab('summary'));

  actions.append(settingsButton, resetButton, finishButton);
  header.append(left, actions);
  return header;
}

function renderTabs() {
  const wrapper = document.createElement('div');
  wrapper.className = 'tabs';

  const sessionTab = document.createElement('div');
  sessionTab.className = `tab ${state.ui.activeTab === 'session' ? 'active' : ''}`;
  sessionTab.textContent = 'Сессия';
  sessionTab.addEventListener('click', () => setActiveTab('session'));

  const summaryTab = document.createElement('div');
  summaryTab.className = `tab ${state.ui.activeTab === 'summary' ? 'active' : ''}`;
  summaryTab.textContent = 'Итоги';
  summaryTab.addEventListener('click', () => setActiveTab('summary'));

  wrapper.append(sessionTab, summaryTab);
  return wrapper;
}

function renderSessionView() {
  const container = document.createElement('div');
  container.className = 'layout';

  const bowlsColumn = document.createElement('div');
  bowlsColumn.className = 'bowls-column';
  bowlsColumn.append(renderBowlsCard());

  const participantsColumn = document.createElement('div');
  participantsColumn.className = 'participants-column';
  participantsColumn.append(renderParticipantsPanel());

  container.append(bowlsColumn, participantsColumn);
  return container;
}

function renderBowlsCard() {
  const card = document.createElement('section');
  card.className = 'card';

  const header = document.createElement('div');
  header.className = 'card__header';
  const title = document.createElement('h2');
  title.textContent = 'Чаши';
  const addButton = document.createElement('button');
  addButton.className = 'primary';
  addButton.textContent = 'Добавить чашу';
  addButton.addEventListener('click', () => openAddBowlModal());
  header.append(title, addButton);

  card.append(header);

  if (state.session.bowls.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Добавьте первую чашу, чтобы начать расчёт';
    card.append(empty);
    return card;
  }

  const list = document.createElement('div');
  list.className = 'bowls-list';

  state.session.bowls.forEach((bowl, index) => {
    const item = document.createElement('div');
    item.className = 'bowl-card';
    if (bowl.id === state.session.activeBowlId) {
      item.classList.add('bowl-card--active');
    }

    const header = document.createElement('div');
    header.className = 'bowl-card__header';

    const left = document.createElement('div');
    left.className = 'bowl-card__left';
    const title = document.createElement('div');
    title.className = 'bowl-card__title';
    title.textContent = bowl.name || `Чаша #${index + 1}`;
    left.append(title);

    if (bowl.id === state.session.activeBowlId) {
      const indicator = document.createElement('span');
      indicator.className = 'active-bowl-indicator';
      indicator.textContent = 'Активная чаша';
      left.append(indicator);
    }

    const right = document.createElement('div');
    right.className = 'bowl-card__right';

    const meta = document.createElement('div');
    meta.className = 'bowl-card__meta';
    const cost = document.createElement('span');
    cost.textContent = `${bowl.cost} ₽`;
    const participantsCount = document.createElement('span');
    participantsCount.textContent = pluralizeParticipants(bowl.participants.length);
    meta.append(cost, participantsCount);

    const setActiveBtn = document.createElement('button');
    setActiveBtn.className = 'secondary';
    setActiveBtn.textContent = bowl.id === state.session.activeBowlId ? 'Активная' : 'Сделать активной';
    setActiveBtn.disabled = bowl.id === state.session.activeBowlId;
    setActiveBtn.addEventListener('click', () => setActiveBowl(bowl.id));

    right.append(meta, setActiveBtn);

    header.append(left, right);

    const participantsWrapper = document.createElement('div');
    participantsWrapper.className = 'bowl-card__participants';

    if (bowl.participants.length === 0) {
      const emptyParticipants = document.createElement('div');
      emptyParticipants.className = 'empty-state';
      emptyParticipants.textContent = 'У этой чаши пока нет участников';
      participantsWrapper.append(emptyParticipants);
    } else {
      bowl.participants.forEach((participantId) => {
        const participant = state.savedParticipants.find((p) => p.id === participantId);
        const chip = document.createElement('div');
        chip.className = 'participant-chip';
        chip.textContent = participant ? participant.name : 'Неизвестно';
        const removeButton = document.createElement('button');
        removeButton.textContent = '×';
        removeButton.title = 'Удалить из чаши';
        removeButton.addEventListener('click', () => removeParticipantFromBowl(bowl.id, participantId));
        chip.append(removeButton);
        participantsWrapper.append(chip);
      });
    }

    item.append(header, participantsWrapper);
    list.append(item);
  });

  card.append(list);
  return card;
}

function renderParticipantsPanel() {
  const card = document.createElement('section');
  card.className = 'card participants-panel';

  const header = document.createElement('div');
  header.className = 'card__header';
  const title = document.createElement('h2');
  title.textContent = 'Участники';
  const addButton = document.createElement('button');
  addButton.className = 'primary';
  addButton.textContent = 'Добавить';
  addButton.addEventListener('click', () => openAddParticipantModal());
  header.append(title, addButton);

  card.append(header);

  const searchWrapper = document.createElement('div');
  searchWrapper.className = 'participants-panel__search';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Поиск по сохранённым людям';

  const activeBowl = getActiveBowl();

  searchInput.addEventListener('input', () => {
    renderSavedParticipantsList(listWrapper, searchInput.value, activeBowl);
  });
  searchWrapper.append(searchInput);

  const listWrapper = document.createElement('div');
  listWrapper.className = 'saved-participants';
  renderSavedParticipantsList(listWrapper, '', activeBowl);

  card.append(searchWrapper, listWrapper);
  return card;
}

function renderSavedParticipantsList(container, searchTerm, activeBowl) {
  container.innerHTML = '';
  const normalized = searchTerm.trim().toLowerCase();
  const filtered = state.savedParticipants.filter((p) =>
    p.name.toLowerCase().includes(normalized)
  );

  filtered.sort((a, b) => a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' }));

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = normalized
      ? 'По запросу ничего не найдено'
      : 'Пока нет сохранённых участников';
    container.append(empty);
    return;
  }

  filtered.forEach((participant) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'saved-participant';
    button.textContent = participant.name;
    button.addEventListener('click', () => addParticipantToActiveBowl(participant.id));
    if (activeBowl?.participants.includes(participant.id)) {
      button.disabled = true;
      button.title = 'Уже в активной чаше';
    }
    container.append(button);
  });
}

function renderSummaryView() {
  const card = document.createElement('section');
  card.className = 'card summary-view';

  const summary = calculateSummary();

  if (summary.totals.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Пока нечего считать. Добавьте чаши и участников.';
    card.append(empty);
    return card;
  }

  const header = document.createElement('div');
  header.className = 'summary-header';

  const title = document.createElement('h2');
  title.textContent = 'Итоговый расчёт';

  const actions = document.createElement('div');
  actions.className = 'summary-actions';

  const copyButton = document.createElement('button');
  copyButton.className = 'secondary';
  copyButton.textContent = 'Скопировать результаты';
  copyButton.addEventListener('click', copySummaryToClipboard);

  const backButton = document.createElement('button');
  backButton.className = 'ghost';
  backButton.textContent = 'Вернуться к сессии';
  backButton.addEventListener('click', () => setActiveTab('session'));

  actions.append(copyButton, backButton);
  header.append(title, actions);

  const table = document.createElement('table');
  table.className = 'summary-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  ['Участник', 'Чаш', 'Сумма'].forEach((text) => {
    const th = document.createElement('th');
    th.textContent = text;
    headRow.append(th);
  });
  thead.append(headRow);

  const tbody = document.createElement('tbody');
  summary.totals.forEach(({ participant, bowls, total }) => {
    const row = document.createElement('tr');
    const nameCell = document.createElement('td');
    nameCell.textContent = participant.name;
    const bowlsCell = document.createElement('td');
    bowlsCell.textContent = bowls;
    const totalCell = document.createElement('td');
    totalCell.textContent = `${total} ₽`;
    row.append(nameCell, bowlsCell, totalCell);
    tbody.append(row);
  });

  table.append(thead, tbody);

  const detailsTitle = document.createElement('div');
  detailsTitle.className = 'section-title';
  detailsTitle.textContent = 'Детализация по чашам';

  const detailsList = document.createElement('div');
  detailsList.className = 'details-list';
  summary.bowls.forEach((bowl, index) => {
    const item = document.createElement('div');
    item.className = 'detail-item';

    const topRow = document.createElement('div');
    topRow.className = 'detail-item__title';
    topRow.innerHTML = `<span>${index + 1}. ${bowl.name}</span><span>${bowl.cost} ₽</span>`;

    const participants = document.createElement('div');
    participants.className = 'detail-item__participants';
    participants.textContent = bowl.participants.length
      ? bowl.participants.map((p) => p.name).join(', ')
      : 'Без участников';

    item.append(topRow, participants);
    detailsList.append(item);
  });

  card.append(header, table, detailsTitle, detailsList);
  return card;
}

function openAddBowlModal() {
  const modal = createModal('Новая чаша');

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Название (опционально)';

  const costInput = document.createElement('input');
  costInput.type = 'number';
  costInput.min = 0;
  costInput.value = state.settings.defaultBowlCost;

  const copyWrapper = document.createElement('label');
  copyWrapper.className = 'checkbox-item';
  const copyCheckbox = document.createElement('input');
  copyCheckbox.type = 'checkbox';
  copyCheckbox.checked = true;
  const copyText = document.createElement('span');
  copyText.textContent = 'Скопировать участников с активной чаши';
  copyWrapper.append(copyCheckbox, copyText);

  modal.content.append(createLabeledField('Название', nameInput));
  modal.content.append(createLabeledField('Стоимость (₽)', costInput));
  modal.content.append(copyWrapper);

  const cancelButton = document.createElement('button');
  cancelButton.className = 'secondary';
  cancelButton.textContent = 'Отмена';
  cancelButton.addEventListener('click', () => modal.close());

  const createButton = document.createElement('button');
  createButton.className = 'primary';
  createButton.textContent = 'Добавить';
  createButton.addEventListener('click', () => {
    addBowl({
      name: nameInput.value,
      cost: Number(costInput.value),
      copyParticipants: copyCheckbox.checked,
    });
    modal.close();
  });

  modal.actions.append(cancelButton, createButton);
  modal.open();
}

function openAddParticipantModal() {
  const modal = createModal('Новый участник');

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Имя';

  const commentInput = document.createElement('input');
  commentInput.type = 'text';
  commentInput.placeholder = 'Комментарий (опционально)';

  modal.content.append(createLabeledField('Имя', nameInput));
  modal.content.append(createLabeledField('Комментарий', commentInput));

  const cancelButton = document.createElement('button');
  cancelButton.className = 'secondary';
  cancelButton.textContent = 'Отмена';
  cancelButton.addEventListener('click', () => modal.close());

  const createButton = document.createElement('button');
  createButton.className = 'primary';
  createButton.textContent = 'Сохранить и добавить';
  createButton.addEventListener('click', () => {
    const participant = upsertParticipant(nameInput.value, commentInput.value);
    if (!participant) {
      alert('Введите имя');
      return;
    }
    addParticipantToActiveBowl(participant.id);
    modal.close();
  });

  modal.actions.append(cancelButton, createButton);
  modal.open();
}

function openSettingsModal() {
  const modal = createModal('Настройки');

  const defaultCostInput = document.createElement('input');
  defaultCostInput.type = 'number';
  defaultCostInput.min = 1;
  defaultCostInput.value = state.settings.defaultBowlCost;

  const participantsList = document.createElement('div');
  participantsList.className = 'details-list';

  if (state.savedParticipants.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Список участников пока пуст';
    participantsList.append(empty);
  } else {
    state.savedParticipants.forEach((participant) => {
      const item = document.createElement('div');
      item.className = 'detail-item';
      const title = document.createElement('div');
      title.className = 'detail-item__title';
      title.innerHTML = `<span>${participant.name}</span>`;

      const removeButton = document.createElement('button');
      removeButton.className = 'ghost';
      removeButton.textContent = 'Удалить';
      removeButton.addEventListener('click', () => {
        if (confirm(`Удалить ${participant.name}?`)) {
          state.savedParticipants = state.savedParticipants.filter((p) => p.id !== participant.id);
          state.session.bowls.forEach((bowl) => {
            bowl.participants = bowl.participants.filter((id) => id !== participant.id);
          });
          persistState();
          modal.close();
          renderApp();
        }
      });

      title.append(removeButton);
      const comment = document.createElement('div');
      comment.className = 'detail-item__participants';
      comment.textContent = participant.comment || 'Без комментария';
      item.append(title, comment);
      participantsList.append(item);
    });
  }

  modal.content.append(createLabeledField('Стоимость чаши по умолчанию (₽)', defaultCostInput));
  modal.content.append(createSectionTitle('Сохранённые участники'));
  modal.content.append(participantsList);

  const cancelButton = document.createElement('button');
  cancelButton.className = 'secondary';
  cancelButton.textContent = 'Закрыть';
  cancelButton.addEventListener('click', () => modal.close());

  const saveButton = document.createElement('button');
  saveButton.className = 'primary';
  saveButton.textContent = 'Сохранить';
  saveButton.addEventListener('click', () => {
    updateSettings({ defaultBowlCost: Number(defaultCostInput.value) });
    modal.close();
  });

  modal.actions.append(cancelButton, saveButton);
  modal.open();
}

function createLabeledField(labelText, input) {
  const wrapper = document.createElement('label');
  wrapper.className = 'labeled-field';
  const label = document.createElement('div');
  label.className = 'section-title';
  label.textContent = labelText;
  wrapper.append(label, input);
  return wrapper;
}

function createSectionTitle(text) {
  const el = document.createElement('div');
  el.className = 'section-title';
  el.textContent = text;
  return el;
}

function createModal(titleText) {
  const template = document.getElementById('modal-template');
  const clone = template.content.firstElementChild.cloneNode(true);
  const modalOverlay = clone;
  const modal = modalOverlay.querySelector('.modal');
  const title = modalOverlay.querySelector('.modal__title');
  const content = modalOverlay.querySelector('.modal__content');
  const actions = modalOverlay.querySelector('.modal__actions');
  const closeButton = modalOverlay.querySelector('[data-close-modal]');

  title.textContent = titleText;

  function handleOverlayClick(event) {
    if (event.target === modalOverlay) {
      close();
    }
  }

  function handleKeydown(event) {
    if (event.key === 'Escape') {
      close();
    }
  }

  function close() {
    modalOverlay.remove();
    document.removeEventListener('keydown', handleKeydown);
  }

  closeButton.addEventListener('click', close);
  modalOverlay.addEventListener('click', handleOverlayClick);

  return {
    element: modalOverlay,
    content,
    actions,
    open() {
      document.body.append(modalOverlay);
      document.addEventListener('keydown', handleKeydown);
    },
    close,
  };
}

window.addEventListener('load', () => {
  renderApp();
});
