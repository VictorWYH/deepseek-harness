/**
 * dashboard-proxy — same-origin reverse proxy for the 6995 board APIs.
 *
 * The 6995 unified dashboard backend (H:\AIWork\dashboard\server.js) is a
 * separate HTTPS server with its own session/CSRF/auth model. Embedding its
 * frontend as an iframe would break login (different origin → cookies/Secure
 * flags don't carry, CSRF origin check fails). Instead this host plugin
 * registers the DSH webserver prefix route `/dashboard/api` and forwards every
 * matched request to the real 6995 server's `/api/*` path, preserving the
 * browser's cookies (`dashboard_session` / `dashboard_csrf`) and the
 * Authorization header. Because the browser talks to the DSH origin only, its
 * session cookie and CSRF token travel as ordinary same-origin headers, and
 * the 6995 server's own permission/CSRF code still makes every decision — this
 * proxy neither bypasses nor weakens any check.
 *
 * Read-endpoints (tasks, task/live, dev-sessions) are public on 6995; write
 * endpoints keep their logged-in + CSRF enforcement untouched (a request that
 * fails there is passed through with the 401/403 status the upstream returns).
 *
 * @module @deepseek-ai/dsh-web-app/dashboard-proxy
 */

import http from 'node:http'
import https from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Stable plugin name. */
export const name = 'dashboard-proxy'

/** Services required: the DSH browser server (to register the prefix route). */
export const inject = ['webServer']

/** Default upstream: the 6995 unified dashboard (HTTPS, self-signed cert). */
const UPSTREAM_BASE = process.env.DASHBOARD_6995_URL ?? 'https://127.0.0.1:6995'

/** The browser-side prefix under which 6995 APIs appear same-origin. */
export const PROXY_PREFIX = '/dashboard/api'

/**
 * Register the same-origin reverse proxy. Strips `/dashboard` from the path so
 * `/dashboard/api/tasks` reaches the upstream `/api/tasks`; the upstream writes
 * its own status/headers/body, which we relay verbatim (including 401/403 and
 * any Set-Cookie the login route returns).
 * @param ctx - plugin context carrying the webServer service.
 */
export function apply(ctx: Context): void {
  const dispose = ctx.webServer.register({
    kind: 'prefix',
    path: PROXY_PREFIX,
    handler(req: IncomingMessage, res: ServerResponse): void {
      const target = upstreamUrl(req.url ?? '/')
      if (target === null) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: 'dashboard proxy: cannot map request path' }))
        return
      }
      const transport = target.protocol === 'https:' ? https : http
      const proxyReq = transport.request(target, {
        method: req.method ?? 'GET',
        headers: relayHeaders(req),
        rejectUnauthorized: false, // 6995 uses a self-signed local cert
      }, (upstream) => {
        const outHeaders: Record<string, string | string[] | number | undefined> = {}
        for (const [key, value] of Object.entries(upstream.headers)) {
          // Node lowercases header names; jsonReply sets them plainly. Relay as-is.
          outHeaders[key] = value
        }
        res.writeHead(upstream.statusCode ?? 502, outHeaders)
        upstream.pipe(res)
      })
      proxyReq.on('error', (error: Error) => {
        if (res.headersSent) {
          res.destroy()
          return
        }
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: `dashboard proxy: upstream unreachable (${error.message})` }))
      })
      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        req.pipe(proxyReq)
      } else {
        proxyReq.end()
      }
    },
  })
  ctx.effect(() => () => { dispose() }, 'dashboard-proxy: route')
}

/** Build the upstream absolute URL: strip `/dashboard`, keep query, host loopback. */
function upstreamUrl(rawUrl: string): URL | null {
  let parsed: URL
  try {
    parsed = new URL(rawUrl, PROXY_BASE)
  } catch {
    return null
  }
  const pathname = parsed.pathname
  if (!pathname.startsWith(PROXY_PREFIX + '/')) return null
  const upstreamPath = pathname.slice('/dashboard'.length) // → /api/...
  try {
    const upstream = new URL(upstreamPath, UPSTREAM_BASE)
    upstream.search = parsed.search
    return upstream
  } catch {
    return null
  }
}

const PROXY_BASE = 'http://dsh.invalid'

/** Forward cookies, Authorization, content headers; drop hop-by-hop hosts. */
function relayHeaders(req: IncomingMessage): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {}
  if (req.headers.cookie) out.cookie = req.headers.cookie
  if (req.headers.authorization) out.authorization = req.headers.authorization
  if (req.headers['content-type']) out['content-type'] = req.headers['content-type']
  if (req.headers['content-length']) out['content-length'] = req.headers['content-length']
  out.accept = req.headers.accept ?? 'application/json'
  return out
}
