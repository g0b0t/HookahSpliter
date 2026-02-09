export async function telegramAuth(initData) {
  return fetch('/auth/telegram', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData }),
  });
}

export async function ping() {
  return fetch('/ping', { cache: 'no-store', credentials: 'include' });
}

export async function grantAdmin(userId) {
  return fetch('/admin/role', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
}
