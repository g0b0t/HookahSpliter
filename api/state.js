export async function fetchState() {
  const res = await fetch('/state', { credentials: 'include' });
  if (!res.ok) return null;
  return res.json();
}

export async function updateState(state, clientRev, { keepalive = false } = {}) {
  return fetch('/state', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state, clientRev }),
    keepalive,
  });
}
