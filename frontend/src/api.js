const TOKEN_KEY = 'rollcall_access_token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {})
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  let response
  try {
    response = await fetch(path, { ...options, headers })
  } catch {
    throw new Error('无法连接后端服务，请确认服务正在运行')
  }

  if (response.status === 401 && path !== '/api/auth/login') {
    setToken(null)
    window.dispatchEvent(new Event('auth-expired'))
  }

  if (!response.ok) {
    let message = `请求失败 (${response.status})`
    try {
      const data = await response.json()
      if (typeof data.detail === 'string') message = data.detail
      else if (Array.isArray(data.detail)) message = data.detail[0]?.msg || message
    } catch {
      // Keep the HTTP fallback message when the response has no JSON body.
    }
    throw new Error(message)
  }

  if (response.status === 204) return null
  return response.json()
}
