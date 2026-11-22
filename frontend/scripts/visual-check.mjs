import { spawn, spawnSync } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..', '..')
const outputDir = path.join(projectRoot, 'docs', 'images')
const profileDir = path.join(projectRoot, 'chrome-profile')
const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const debugPort = 9333

await mkdir(outputDir, { recursive: true })
await rm(profileDir, { recursive: true, force: true })

const loginResponse = await fetch('http://127.0.0.1:8000/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: process.env.ATTENDANCE_PASSWORD || '2006' }),
})
if (!loginResponse.ok) throw new Error('Could not obtain a visual-check access token')
const { token } = await loginResponse.json()

const chrome = spawn(chromePath, [
  '--headless',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`,
  'about:blank',
], { stdio: 'ignore', windowsHide: true })

async function waitForDebugger() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      if (response.ok) return
    } catch {
      // Chrome is still starting.
    }
    await delay(100)
  }
  throw new Error('Chrome DevTools endpoint did not become ready')
}

function createClient(socketUrl) {
  const socket = new WebSocket(socketUrl)
  let sequence = 0
  const pending = new Map()

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (!message.id || !pending.has(message.id)) return
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) reject(new Error(message.error.message))
    else resolve(message.result)
  }

  const opened = new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = () => reject(new Error('Could not connect to Chrome DevTools'))
  })

  return {
    opened,
    send(method, params = {}) {
      const id = ++sequence
      socket.send(JSON.stringify({ id, method, params }))
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
    },
    close() { socket.close() },
  }
}

async function screenshot(client, filename) {
  const result = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  })
  await writeFile(path.join(outputDir, filename), Buffer.from(result.data, 'base64'))
}

try {
  await waitForDebugger()
  const tabResponse = await fetch(
    `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent('http://127.0.0.1:5173/')}`,
    { method: 'PUT' },
  )
  const tab = await tabResponse.json()
  const client = createClient(tab.webSocketDebuggerUrl)
  await client.opened
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 960,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await client.send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
  await delay(600)
  await screenshot(client, 'login-desktop.png')
  await client.send('Runtime.evaluate', {
    expression: `localStorage.setItem('rollcall_access_token', ${JSON.stringify(token)}); location.reload()`,
  })
  await delay(900)
  await screenshot(client, 'attendance-desktop.png')

  const pages = [
    ['排行', 'ranking-desktop.png'],
    ['考核', 'assessment-desktop.png'],
    ['分析', 'analytics-desktop.png'],
    ['日志', 'logs-desktop.png'],
    ['成员管理', 'members-desktop.png'],
  ]
  for (const [label, filename] of pages) {
    await client.send('Runtime.evaluate', {
      expression: `Array.from(document.querySelectorAll('.sidebar nav button')).find((button) => button.textContent.includes(${JSON.stringify(label)}))?.click()`,
    })
    await delay(450)
    await screenshot(client, filename)
  }

  await client.send('Runtime.evaluate', {
    expression: `Array.from(document.querySelectorAll('.sidebar nav button')).find((button) => button.textContent.includes('签到'))?.click()`,
  })
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  })
  await delay(500)
  await screenshot(client, 'attendance-mobile.png')
  await client.send('Runtime.evaluate', {
    expression: `Array.from(document.querySelectorAll('.mobile-nav button')).find((button) => button.textContent.includes('分析'))?.click()`,
  })
  await delay(500)
  await screenshot(client, 'analytics-mobile.png')
  await client.send('Runtime.evaluate', {
    expression: `localStorage.removeItem('rollcall_access_token'); location.reload()`,
  })
  await delay(700)
  await screenshot(client, 'login-mobile.png')
  client.close()
  console.log(`Visual checks saved to ${outputDir}`)
} finally {
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    chrome.kill('SIGTERM')
  }
}
