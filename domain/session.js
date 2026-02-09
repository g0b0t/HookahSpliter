export const createId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const getDefaultSessionName = () => {
  const now = new Date();
  return `Вечер ${now.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}`;
};

export function ensureActiveBowl(session) {
  if (!session) return null;
  let bowl = session.bowls.find((b) => b.id === session.activeBowlId);
  if (!bowl && session.bowls.length) {
    bowl = session.bowls[0];
    session.activeBowlId = bowl.id;
  }
  return bowl || null;
}

export function computeSummary(session, personMap) {
  if (!session) return { rows: [], total: 0 };
  const summaryMap = new Map();
  let totalCost = 0;

  session.bowls.forEach((bowl) => {
    const participants = bowl.participantIds || [];
    const cost = Number(bowl.cost) || 0;
    totalCost += cost;
    if (!participants.length) return;
    const share = cost / participants.length;
    participants.forEach((personId) => {
      const person = personMap.get(personId);
      const key = person?.name || 'Без имени';
      const existing = summaryMap.get(key) || { name: key, total: 0, bowlsCount: 0 };
      existing.total += share;
      existing.bowlsCount += 1;
      summaryMap.set(key, existing);
    });
  });

  const rows = Array.from(summaryMap.values()).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'ru'));
  return { rows, total: totalCost };
}
