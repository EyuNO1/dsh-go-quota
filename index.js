/**
 * Go multi-account quota cards — host half.
 *
 * Keeps one local list of OpenCode Go subscription keys, queries
 * https://opencode.ai/zen/go/v1/usage for every account in parallel, and owns
 * the "which key is in use" switch. Switching writes the shared
 * OPENCODE_GO_API_KEY credential, so the model route and the bottom-left cost
 * panel both resolve the selected key on their very next operation.
 *
 * Keys never leave this machine except as the Bearer token of that official
 * quota call. Responses only ever carry a masked key.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

const BASE = '/go-quota'
const UPSTREAM = 'https://opencode.ai/zen/go/v1/usage'
// opencode.ai sits behind Cloudflare; a browser UA is required (error 1010 otherwise).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const TIMEOUT_MS = 15000
const MAX_BODY = 16 * 1024
const USAGE_TTL_MS = 20_000
const COST_METER_WAIT_MS = 10_000
const CREDENTIAL_REF = 'OPENCODE_GO_API_KEY'

export const name = 'go-quota'
export const inject = ['webServer']

// ── Store ────────────────────────────────────────────────────────────────────

let storeCache = null
let readyPromise = null
let ready = false
let writeQueue = Promise.resolve()

// id -> { at, key, result }
const usageCache = new Map()
let usageInFlight = null

function dataDir() {
  const home = process.env.DSH_HOME && process.env.DSH_HOME.trim() ? process.env.DSH_HOME.trim() : join(homedir(), '.dsh')
  return join(home, 'plugin-data', 'dsh-go-quota')
}

function storeFile() {
  return join(dataDir(), 'accounts.json')
}

function emptyStore() {
  return { version: 2, initialized: false, activeId: null, accounts: [] }
}

function normalizeStore(raw) {
  const accounts = Array.isArray(raw?.accounts)
    ? raw.accounts
      .filter((a) => a && typeof a.id === 'string' && a.id && typeof a.key === 'string' && a.key)
      .map((a) => ({
        id: a.id,
        name: typeof a.name === 'string' && a.name.trim() ? a.name.trim().slice(0, 48) : 'Go 账号',
        key: a.key,
        createdAt: typeof a.createdAt === 'string' ? a.createdAt : new Date().toISOString(),
      }))
    : []
  let activeId = typeof raw?.activeId === 'string' && raw.activeId ? raw.activeId : null
  if (activeId !== null && !accounts.some((a) => a.id === activeId)) activeId = null
  return { version: 2, initialized: raw?.initialized === true, activeId, accounts }
}

async function readStore() {
  if (storeCache) return storeCache
  try {
    const raw = JSON.parse(await readFile(storeFile(), 'utf8'))
    storeCache = normalizeStore(raw)
  } catch {
    storeCache = emptyStore()
  }
  return storeCache
}

async function writeStore(store) {
  await mkdir(dataDir(), { recursive: true })
  const file = storeFile()
  const temp = file + '.' + process.pid + '.tmp'
  const content = JSON.stringify(store, null, 2) + '\n'
  await writeFile(temp, content, { mode: 0o600 })
  try {
    await rename(temp, file)
  } catch {
    // A locked target (antivirus, another reader) must not lose the edit.
    await writeFile(file, content, { mode: 0o600 })
    await rm(temp, { force: true }).catch(() => undefined)
  }
  storeCache = store
}

/** Serialize mutations so two browser tabs cannot lose one another's account edit. */
function serialize(operation) {
  const run = writeQueue.then(operation, operation)
  writeQueue = run.then(() => undefined, () => undefined)
  return run
}

// ── Credentials ─────────────────────────────────────────────────────────────

function credentialService(ctx) {
  try {
    const service = ctx.get('credentials')
    return service && typeof service.resolve === 'function' ? service : undefined
  } catch {
    return undefined
  }
}

async function currentCredential(ctx) {
  const service = credentialService(ctx)
  if (!service) return undefined
  try {
    return await service.resolve(CREDENTIAL_REF)
  } catch {
    return undefined
  }
}

/**
 * First activation imports the key that is already in use as a normal account,
 * so installing the plugin never loses or duplicates the existing credential.
 * The import only runs while the credential seam is available; a not-yet-ready
 * seam leaves the store uninitialized and the next request retries.
 */
async function initialize(ctx) {
  const service = credentialService(ctx)
  if (!service) return null
  const store = await readStore()
  if (!store.initialized) {
    let imported = null
    if (store.accounts.length === 0) {
      try {
        const hit = await service.resolve(CREDENTIAL_REF)
        const key = typeof hit?.value === 'string' ? hit.value.trim() : ''
        if (key) {
          imported = { id: randomUUID(), name: '默认账号', key, createdAt: new Date().toISOString() }
          store.accounts.push(imported)
          store.activeId = imported.id
        }
      } catch {
        return null
      }
    }
    store.initialized = true
    await writeStore(store)
    if (imported) ctx.logger?.info?.('[go-quota] imported the credential already in use as "默认账号"')
  }

  await reconcileActive(ctx, store)
  return store
}

/**
 * Keeps `activeId` truthful: the account whose key is actually in the shared
 * credential slot is the one in use. A key set outside this plugin clears the
 * active marker instead of pretending an account is in use.
 */
async function reconcileActive(ctx, store) {
  if (!credentialService(ctx)) return
  const hit = await currentCredential(ctx)
  const key = typeof hit?.value === 'string' ? hit.value.trim() : ''
  const match = key ? store.accounts.find((account) => account.key === key) : undefined
  const next = match ? match.id : null
  if (store.activeId !== next) {
    store.activeId = next
    await writeStore(store)
  }
}

async function ensureReady(ctx) {
  if (ready && storeCache) return storeCache
  if (!readyPromise) {
    readyPromise = initialize(ctx)
      .then((store) => {
        if (store) ready = true
        return store
      })
      .finally(() => {
        readyPromise = null
      })
  }
  const store = await readyPromise
  if (store) return store
  return readStore()
}

/**
 * Refresh the bottom-left cost panel's Go quota right after a switch. It reads
 * the credential per query, so this is what makes the panel show the new
 * account immediately instead of waiting for its own 15-minute cache. Waiting
 * is bounded: a slow upstream must not hold the card switch hostage.
 */
async function pokeCostMeter(ctx) {
  let service
  try {
    service = ctx.get('costMeter')
  } catch {
    return
  }
  if (!service || typeof service.refreshGoQuota !== 'function') return
  let timer = null
  try {
    await Promise.race([
      Promise.resolve(service.refreshGoQuota()).catch(() => undefined),
      new Promise((resolve) => {
        timer = setTimeout(resolve, COST_METER_WAIT_MS)
        timer.unref?.()
      }),
    ])
  } catch {
    // The cost panel is a decoration; a failed refresh must not fail the switch.
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

// ── Upstream ────────────────────────────────────────────────────────────────

function normalizeWindow(value) {
  if (!value || typeof value !== 'object') return null
  const percent = Number(value.percent)
  return {
    percent: Number.isFinite(percent) ? percent : null,
    status: typeof value.status === 'string' ? value.status : undefined,
    resetsAt: typeof value.resetsAt === 'string' ? value.resetsAt : null,
  }
}

async function queryKey(key) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(UPSTREAM, {
      headers: {
        authorization: 'Bearer ' + key,
        'user-agent': UA,
        accept: 'application/json',
      },
      signal: controller.signal,
    })
    if (response.status === 401) return { ok: false, code: 'unauthorized', error: 'HTTP 401' }
    if (response.status === 403) return { ok: false, code: 'forbidden', error: 'HTTP 403' }
    if (!response.ok) return { ok: false, code: 'http', error: 'HTTP ' + response.status }
    const payload = await response.json()
    const usage = payload?.usage
    if (!usage || typeof usage !== 'object') return { ok: false, code: 'payload', error: 'missing usage' }
    return {
      ok: true,
      rolling: normalizeWindow(usage.rolling),
      weekly: normalizeWindow(usage.weekly),
      monthly: normalizeWindow(usage.monthly),
    }
  } catch (error) {
    if (error?.name === 'AbortError') return { ok: false, code: 'timeout', error: 'timeout' }
    return { ok: false, code: 'network', error: String(error?.message || error) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Return one result per account, reusing a 20-second cache. Only missing or
 * stale rows are fetched, so adding an account does not re-query the rest.
 */
async function usageFor(store, force) {
  if (usageInFlight) await usageInFlight.catch(() => undefined)
  const now = Date.now()
  const out = new Map()
  const todo = []
  for (const account of store.accounts) {
    const hit = usageCache.get(account.id)
    if (!force && hit && hit.key === account.key && now - hit.at < USAGE_TTL_MS) out.set(account.id, hit.result)
    else todo.push(account)
  }
  if (todo.length === 0) return out

  const task = Promise.all(todo.map(async (account) => {
    const result = await queryKey(account.key)
    usageCache.set(account.id, { at: Date.now(), key: account.key, result })
    return [account.id, result]
  }))
  usageInFlight = task
  try {
    for (const [id, result] of await task) out.set(id, result)
  } finally {
    if (usageInFlight === task) usageInFlight = null
  }
  return out
}

// ── Presentation helpers ────────────────────────────────────────────────────

function mask(key) {
  const text = String(key)
  if (text.length <= 8) return text.slice(0, 2) + '***'
  return text.slice(0, 4) + '…' + text.slice(-4)
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

function sendError(res, status, code, message) {
  sendJson(res, status, { ok: false, code, error: message })
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

async function readJson(req) {
  try {
    const value = await readBody(req)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    throw httpError(400, 'bad-request', '请求内容不是有效的 JSON')
  }
}

/** Browser writes must come from this very page; non-browser callers have no Origin. */
function sameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

function normalizeKey(value) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/^Bearer[ \t]+/i, '').trim()
}

function validateName(value) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name) return ''
  if (name.length > 48 || /[\u0000-\u001f\u007f]/.test(name)) return ''
  return name
}

function validateKey(value) {
  const key = normalizeKey(value)
  if (key.length < 8 || key.length > 512) return ''
  if (/\s/.test(key)) return ''
  return key
}

// ── State ───────────────────────────────────────────────────────────────────

function publicRow(store, account, result) {
  return {
    id: account.id,
    name: account.name,
    keyMasked: mask(account.key),
    createdAt: account.createdAt,
    active: store.activeId === account.id,
    ...(result || { ok: false, code: 'pending', error: 'not queried' }),
  }
}

async function buildState(ctx, force) {
  const store = await ensureReady(ctx)
  const usage = await usageFor(store, force === true)
  return {
    ok: true,
    at: new Date().toISOString(),
    activeId: store.activeId,
    accounts: store.accounts.map((account) => publicRow(store, account, usage.get(account.id))),
  }
}

async function activate(ctx, id) {
  const store = await ensureReady(ctx)
  const account = store.accounts.find((row) => row.id === id)
  if (!account) throw httpError(404, 'not-found', '账号不存在')

  const service = credentialService(ctx)
  if (!service || typeof service.set !== 'function') {
    throw httpError(503, 'credentials-unavailable', '宿主没有可用的凭据服务，无法切换 Key')
  }

  // Never hand the model route a key whose quota endpoint says it is unusable.
  const cached = usageCache.get(account.id)
  const result = cached && cached.key === account.key ? cached.result : null
  if (result && (result.code === 'unauthorized' || result.code === 'forbidden')) {
    throw httpError(400, 'key-unusable', result.code === 'unauthorized' ? 'Key 无效或已过期' : '该 Key 没有 Go 订阅')
  }

  try {
    await service.set(CREDENTIAL_REF, account.key)
  } catch (error) {
    throw httpError(502, 'write-failed', '写入凭据失败：' + String(error?.message || error))
  }

  // Prove the seam now resolves to this account's key without exposing it.
  const hit = await currentCredential(ctx)
  if (!hit || hit.value !== account.key) {
    throw httpError(502, 'write-failed', '凭据写入后未能读回同一个 Key')
  }

  if (store.activeId !== account.id) {
    store.activeId = account.id
    await writeStore(store)
  }
  await pokeCostMeter(ctx)
  return buildState(ctx, false)
}

function httpError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

// ── Routes ──────────────────────────────────────────────────────────────────

function createHandler() {
  return async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost')
    const route = url.pathname.slice(BASE.length) || '/'
    const method = (req.method || 'GET').toUpperCase()

    if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(req)) {
      sendError(res, 403, 'forbidden-origin', '请求来源不受信任')
      return
    }

    try {
      if (route === '/state' && method === 'GET') {
        const force = url.searchParams.get('force') === '1'
        sendJson(res, 200, await buildState(handlerCtx, force))
        return
      }

      if (route === '/refresh' && method === 'POST') {
        sendJson(res, 200, await buildState(handlerCtx, true))
        return
      }

      if (route === '/accounts' && method === 'POST') {
        const body = await readJson(req)
        const name = validateName(body.name)
        const key = validateKey(body.key)
        if (!name) { sendError(res, 400, 'invalid-name', '账号名不能为空，且不能超过 48 个字符'); return }
        if (!key) { sendError(res, 400, 'invalid-key', 'API Key 不能为空，且不能包含空格或换行'); return }
        const state = await serialize(async () => {
          const store = await ensureReady(handlerCtx)
          if (store.accounts.some((account) => account.key === key)) {
            throw httpError(409, 'duplicate-key', '这个 Key 已经添加过了')
          }
          store.accounts.push({ id: randomUUID(), name, key, createdAt: new Date().toISOString() })
          await writeStore(store)
          return buildState(handlerCtx, false)
        })
        sendJson(res, 200, state)
        return
      }

      if (route === '/accounts/remove' && method === 'POST') {
        const body = await readJson(req)
        const id = typeof body.id === 'string' ? body.id : ''
        const state = await serialize(async () => {
          const store = await ensureReady(handlerCtx)
          const account = store.accounts.find((row) => row.id === id)
          if (!account) throw httpError(404, 'not-found', '账号不存在')
          const wasActive = store.activeId === account.id
          store.accounts = store.accounts.filter((row) => row.id !== account.id)
          usageCache.delete(account.id)
          if (wasActive) {
            const next = store.accounts[0]
            const service = credentialService(handlerCtx)
            if (next && service?.set) {
              await service.set(CREDENTIAL_REF, next.key)
              store.activeId = next.id
            } else {
              store.activeId = null
              if (service?.unset) await service.unset(CREDENTIAL_REF).catch(() => undefined)
            }
          }
          await writeStore(store)
          if (wasActive) await pokeCostMeter(handlerCtx)
          return buildState(handlerCtx, false)
        })
        sendJson(res, 200, state)
        return
      }

      if (route === '/activate' && method === 'POST') {
        const body = await readJson(req)
        const id = typeof body.id === 'string' ? body.id : ''
        const state = await serialize(() => activate(handlerCtx, id))
        sendJson(res, 200, state)
        return
      }

      sendError(res, 404, 'not-found', '未知接口')
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500
      const code = typeof error?.code === 'string' ? error.code : 'internal'
      sendError(res, status, code, String(error?.message || error))
    }
  }
}

// The handler needs the plugin context; a module-level binding keeps the route
// table small while still being scoped to this one mounted plugin instance.
let handlerCtx = null

export function apply(ctx) {
  handlerCtx = ctx
  void ensureReady(ctx).catch((error) => {
    ctx.logger?.warn?.('[go-quota] initialization deferred: ' + String(error?.message || error))
  })
  const handler = createHandler()
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: BASE, handler }), 'go-quota: account cards and key switching')
}
