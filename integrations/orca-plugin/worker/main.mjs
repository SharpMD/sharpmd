// SharpMD plugin worker. The panel has no network, so every call to SharpMD happens here.
// The token lives in Orca's `secrets` (secrets.get / secrets.set) and is never logged or sent to the panel.

const TOKEN_KEY = 'token'
const MAX_BOARD_NOTES = 25
const DEFAULT_URL = 'https://sync.sharpmd.app/mcp'

/** @param {import('orca/worker').OrcaWorkerApi} orca */
export default async function activate(orca) {
  let rpcId = 0

  const getToken = async () => {
    const { value } = await orca.host.call('secrets.get', { key: TOKEN_KEY })
    return value
  }

  const serverUrl = async () => {
    const raw = String((await orca.settings.get('serverUrl')) || DEFAULT_URL).trim()
    let u
    try {
      u = new URL(raw)
    } catch {
      throw coded('invalid_params', 'The SharpMD MCP URL in settings is not a URL.')
    }
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
    if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) {
      throw coded('invalid_params', 'The SharpMD MCP URL must use https.')
    }
    return u.toString()
  }

  // One tools/call over Streamable HTTP. The server is stateless: no initialize, no session header.
  async function tool(name, args) {
    const token = await getToken()
    if (!token) throw coded('not_permitted', 'No SharpMD token yet.')
    const res = await fetch(await serverUrl(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer ' + token
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++rpcId,
        method: 'tools/call',
        params: { name, arguments: args }
      }),
      signal: AbortSignal.timeout(20000)
    })
    if (res.status === 401 || res.status === 403) throw coded('not_permitted', 'SharpMD rejected the token.')
    if (!res.ok) throw coded('action_failed', 'SharpMD answered HTTP ' + res.status + '.')
    const msg = await res.json()
    if (msg.error) throw coded('action_failed', String(msg.error.message || 'SharpMD error'))
    const r = msg.result || {}
    const text = (r.content || []).map((b) => b.text || '').join('\n')
    if (r.isError) throw coded('action_failed', text.slice(0, 300) || 'SharpMD error')
    if (r.structuredContent) return r.structuredContent
    try {
      return JSON.parse((r.content && r.content[0] && r.content[0].text) || 'null')
    } catch {
      return text
    }
  }

  const boardsOf = async (path) => {
    const r = await tool('list_boards', { path })
    return { path: r.path || path, url: r.url || null, boards: Array.isArray(r.boards) ? r.boards : [] }
  }

  orca.panels.handle('state', async () => {
    const token = await getToken()
    return { tokenSet: Boolean(token), agent: String((await orca.settings.get('agent')) || 'claude') }
  })

  orca.panels.handle('token.save', async ({ token }) => {
    const t = typeof token === 'string' ? token.trim() : ''
    if (!t || t.length > 512 || /\s/.test(t)) throw coded('invalid_params', 'That does not look like a token.')
    await orca.host.call('secrets.set', { key: TOKEN_KEY, value: t })
    return { tokenSet: true }
  })

  orca.panels.handle('token.clear', async () => {
    await orca.host.call('secrets.delete', { key: TOKEN_KEY })
    return { tokenSet: false }
  })

  orca.panels.handle('boards.load', async () => {
    const wanted = String((await orca.settings.get('boardPaths')) || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    let paths = wanted
    if (!paths.length) {
      const notes = await tool('list_notes', {})
      paths = (Array.isArray(notes) ? notes : [])
        .map((n) => n && n.path)
        .filter((p) => typeof p === 'string' && /board|tablero|kanban/i.test(p))
        .slice(0, MAX_BOARD_NOTES)
    }
    const found = []
    let skipped = 0
    await Promise.all(
      paths.map(async (p) => {
        try {
          const b = await boardsOf(p)
          if (b.boards.length) found.push(b)
        } catch {
          skipped++
        }
      })
    )
    found.sort((a, b) => a.path.localeCompare(b.path))
    return { notes: found, skipped }
  })

  orca.panels.handle('projects.list', async () => {
    const { projects } = await orca.host.call('project.list')
    return {
      projects: projects
        .filter((p) => p.kind === 'git' && !p.hidden)
        .map((p) => ({ id: p.id, name: p.name }))
    }
  })

  orca.panels.handle('card.start', async (input) => {
    const c = cleanCard(input)
    const { projects } = await orca.host.call('project.list')
    const git = projects.filter((p) => p.kind === 'git')
    // A card with a `repo` field picks its project by name or folder; otherwise the panel's choice.
    let project = c.repo ? git.find((p) => sameRepo(p, c.repo)) : null
    if (!project) project = git.find((p) => p.id === c.projectId)
    if (!project) {
      throw coded(
        'invalid_params',
        c.repo ? 'No Orca project matches repo "' + c.repo + '". Pick one in the panel.' : 'Pick a repository first.'
      )
    }

    const agent = String((await orca.settings.get('agent')) || 'claude')
    const params = { projectId: project.id, name: workspaceName(c.title), agent, prompt: buildPrompt(c) }
    if (project.hostId) params.hostId = project.hostId
    const { workspaceId } = await orca.host.call('workspace.create', params)

    let moved = false
    let moveError = null
    if (c.progressColumn && c.column !== c.progressColumn) {
      try {
        await tool('move_card', { path: c.path, id: c.id, column: c.progressColumn })
        moved = true
      } catch (e) {
        moveError = String((e && e.message) || 'move failed')
      }
    }
    try {
      await orca.host.call('notifications.show', { title: 'SharpMD', body: 'Started: ' + c.title.slice(0, 80) })
    } catch {
      // the notification is a courtesy
    }
    return { workspaceId, project: project.name, moved, moveError }
  })
}

// ---- helpers ----
function coded(code, message) {
  const e = new Error(message)
  e.code = code
  return e
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')

function cleanCard(i) {
  const o = i && typeof i === 'object' ? i : {}
  const fields = {}
  if (o.fields && typeof o.fields === 'object') {
    for (const [k, v] of Object.entries(o.fields).slice(0, 30)) {
      if (['string', 'number', 'boolean'].includes(typeof v)) fields[str(k, 60)] = str(String(v), 2000)
    }
  }
  const c = {
    path: str(o.path, 500),
    id: str(o.id, 100),
    title: str(o.title, 400),
    column: str(o.column, 200),
    doneColumn: str(o.doneColumn, 200),
    progressColumn: str(o.progressColumn, 200),
    projectId: str(o.projectId, 200),
    fields,
    repo: str(fields.repo, 300).trim()
  }
  if (!c.path || !c.id || !c.title) throw coded('invalid_params', 'The card is missing its path, id or title.')
  return c
}

const norm = (s) => String(s).toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '').replace(/\.git$/, '')
function sameRepo(p, repo) {
  const r = norm(repo)
  const tail = r.split('/').pop()
  const base = norm(p.path).split('/').pop()
  return norm(p.name) === r || norm(p.name) === tail || base === tail || norm(p.path).endsWith('/' + r)
}

function workspaceName(title) {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  return slug || 'sharpmd-card'
}

function buildPrompt(c) {
  const lines = ['You are working on a task from a SharpMD board.', '', 'Task: ' + c.title]
  const extra = Object.entries(c.fields)
  if (extra.length) {
    lines.push('', 'Card fields:')
    for (const [k, v] of extra) lines.push('- ' + k + ': ' + v)
  }
  lines.push('', 'SharpMD location: ' + c.path + ' #' + c.id, '')
  const where = c.doneColumn ? ' (path "' + c.path + '", id "' + c.id + '", column "' + c.doneColumn + '")' : ''
  lines.push('When you finish, move the card to the done column with the SharpMD MCP (move_card)' + where + '.')
  return lines.join('\n')
}
