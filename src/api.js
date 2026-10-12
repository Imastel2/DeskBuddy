export async function apiFetch(url, options = {}) {
  const userId = sessionStorage.getItem('deskbuddy_user_id')
  const headers = new Headers(options.headers)

  if (userId) headers.set('X-DeskBuddy-User', userId)

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'same-origin',
  })

  if (response.status === 401) {
    window.dispatchEvent(new Event('deskbuddy-signout'))
  }

  return response
}