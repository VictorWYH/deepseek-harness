#!/usr/bin/env node
/**
 * Fail-closed launcher for DSH deployment instances (Windows compatible).
 *
 * Reads deployment/instances/<id>.json and launches the instance's DSH
 * binary with an explicitly isolated DSH_HOME and port. The tool never stops
 * or restarts an existing service: it refuses to start when the target port
 * is already listening.
 *
 * Usage:
 *   node run-instance.mjs --instance <id> [--dry-run] [--] <dsh args...>
 *
 * Examples:
 *   node run-instance.mjs --instance dashboard-dev --dry-run -- web --no-open
 *   node run-instance.mjs --instance dashboard-dev -- web --no-open
 *
 * Exit codes: 0 = launched (or dry-run printed), 1 = validation/launch failure.
 */
import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import net from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const deploymentRoot = resolve(dirname(fileURLToPath(import.meta.url)))
const instancesDir = resolve(deploymentRoot, 'instances')
const INSTANCE_IDS = ['native', 'dashboard-dev', 'dashboard']

const USAGE = 'usage: node run-instance.mjs --instance <id> [--dry-run] [--] <dsh args...>'

function fail(message) {
  console.error(`[run-instance] ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const result = { instance: undefined, dryRun: false, dshArgs: [] }
  let afterSeparator = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (afterSeparator) {
      result.dshArgs.push(arg)
      continue
    }
    if (arg === '--') { afterSeparator = true; continue }
    if (arg === '--dry-run') { result.dryRun = true; continue }
    if (arg === '--instance') {
      const value = argv[++i]
      if (value === undefined || value === '') fail('--instance requires a value')
      result.instance = value
      continue
    }
    if (arg.startsWith('--instance=')) {
      result.instance = arg.slice('--instance='.length)
      continue
    }
    if (arg === '--help' || arg === '-h') { console.log(USAGE); process.exit(0) }
    fail(`unknown argument: ${arg}\n${USAGE}`)
  }
  if (result.instance === undefined) fail(`--instance is required\n${USAGE}`)
  return result
}

function normalizeKey(value) {
  return String(value).replaceAll('\\', '/').toLowerCase()
}

/** Load every instance JSON; enforces the cross-instance fail-closed contract. */
async function loadInstances() {
  const instances = []
  const ports = new Set()
  const homes = new Set()
  for (const id of INSTANCE_IDS) {
    const file = resolve(instancesDir, `${id}.json`)
    if (!existsSync(file)) fail(`missing instance file: ${file}`)
    let data
    try {
      data = JSON.parse(await readFile(file, 'utf8'))
    } catch (error) {
      fail(`cannot parse ${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (data.id !== id) fail(`${file}: instance id must match file name (expected "${id}", got "${data.id}")`)
    if (typeof data.port !== 'number' || !Number.isInteger(data.port) || data.port < 1 || data.port > 65535) {
      fail(`${file}: invalid port ${JSON.stringify(data.port)} (must be integer 1..65535)`)
    }
    if (ports.has(data.port)) fail(`${file}: duplicate port ${data.port}`)
    ports.add(data.port)
    if (typeof data.home !== 'string' || data.home.length === 0) fail(`${file}: missing home`)
    const homeKey = normalizeKey(data.home)
    if (homes.has(homeKey)) fail(`${file}: shared home ${data.home}`)
    homes.add(homeKey)
    if (data.allowSharedHome !== false) fail(`${file}: allowSharedHome must be false`)
    if (typeof data.sourceRoot !== 'string' || data.sourceRoot.length === 0) fail(`${file}: missing sourceRoot`)
    if (!existsSync(data.sourceRoot)) fail(`${file}: sourceRoot does not exist: ${data.sourceRoot}`)
    if (data.shell !== 'native' && data.shell !== 'dashboard') {
      fail(`${file}: shell must be "native" or "dashboard", got ${JSON.stringify(data.shell)}`)
    }
    instances.push({ file, ...data })
  }
  const native = instances.find((instance) => instance.id === 'native')
  const dashboard = instances.find((instance) => instance.id === 'dashboard')
  const dev = instances.find((instance) => instance.id === 'dashboard-dev')
  if (native === undefined || dashboard === undefined || dev === undefined) fail('required instances are missing')
  if (normalizeKey(native.sourceRoot) === normalizeKey(dashboard.sourceRoot)) {
    fail('native and dashboard sourceRoot must differ')
  }
  return instances
}

/** Resolve the instance's DSH bin (native: sourceRoot/lib/bin.js; dashboard: sourceRoot/apps/cli/lib/bin.js). */
function resolveBin(instance) {
  const relative = instance.shell === 'dashboard' ? 'apps/cli/lib/bin.js' : 'lib/bin.js'
  const bin = resolve(instance.sourceRoot, relative)
  if (!existsSync(bin)) fail(`${instance.file}: bin not found: ${bin}`)
  return bin
}

/** True when something listens on 127.0.0.1:<port>. */
function isPortListening(port) {
  return new Promise((done) => {
    const socket = new net.Socket()
    let settled = false
    const finish = (ok) => {
      if (settled) return
      settled = true
      socket.destroy()
      done(ok)
    }
    socket.setTimeout(1000)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, '127.0.0.1')
  })
}

/** Best-effort owning PID for a listening port; returns undefined when unknown. */
function owningPid(port) {
  return new Promise((done) => {
    execFile('netstat.exe', ['-ano', '-p', 'tcp'], {
      timeout: 5000, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
    }, (netstatError, netstatOut) => {
      if (!netstatError) {
        const wanted = `:${port}`
        for (const line of String(netstatOut).split(/\r?\n/)) {
          const match = /^\s*TCP\s+(\S+:\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i.exec(line)
          if (match && match[1].endsWith(wanted)) {
            const pid = Number(match[2])
            if (Number.isInteger(pid) && pid > 0) return done(pid)
          }
        }
      }
      const psCmd = `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)`
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCmd], {
        timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024,
      }, (error, stdout) => {
        if (error) return done(undefined)
        const pid = Number(String(stdout).trim())
        done(Number.isInteger(pid) && pid > 0 ? pid : undefined)
      })
    })
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const instances = await loadInstances()
  const instance = instances.find((candidate) => candidate.id === args.instance)
  if (instance === undefined) fail(`unknown instance "${args.instance}" (expected one of: ${INSTANCE_IDS.join(', ')})`)

  if (await isPortListening(instance.port)) {
    const pid = await owningPid(instance.port)
    fail(`port ${instance.port} is already in use${pid === undefined ? '' : ` (PID ${pid})`}; refusing to start ${instance.id}`)
  }

  if (args.dshArgs.some((arg) => arg === '--port' || arg.startsWith('--port='))) {
    fail('do not pass --port in <dsh args>: the instance port is managed by run-instance.mjs')
  }

  const bin = resolveBin(instance)
  const env = { ...process.env, DSH_HOME: instance.home }
  // The `web` alias is a profile command; parent options such as --patch are
  // rejected after that alias, so normalize it to the equivalent --profile web
  // invocation and keep --patch before the app arguments.
  const dshArgs = [...args.dshArgs]
  const webIndex = dshArgs.indexOf('web')
  if (webIndex >= 0) dshArgs.splice(webIndex, 1)
  const parentOptions = []
  const patchIndex = dshArgs.findIndex((arg) => arg === '--patch' || arg.startsWith('--patch='))
  if (patchIndex >= 0) {
    parentOptions.push(dshArgs[patchIndex])
    if (dshArgs[patchIndex] === '--patch') {
      const patchValue = dshArgs[patchIndex + 1]
      if (patchValue === undefined) fail('--patch requires a value')
      parentOptions.push(patchValue)
      dshArgs.splice(patchIndex, 2)
    } else {
      dshArgs.splice(patchIndex, 1)
    }
  }
  dshArgs.unshift('--profile', 'web')
  dshArgs.unshift(...parentOptions)
  dshArgs.push('--port', String(instance.port))

  console.log(`[run-instance] instance: ${instance.id}`)
  console.log(`[run-instance] shell: ${instance.shell}`)
  console.log(`[run-instance] bin: ${bin}`)
  console.log(`[run-instance] env: DSH_HOME=${instance.home}`)
  console.log(`[run-instance] command: ${process.execPath} ${bin} ${dshArgs.join(' ')}`)

  if (args.dryRun) {
    console.log('[run-instance] dry-run: not launching')
    process.exit(0)
  }

  const child = spawn(process.execPath, [bin, ...dshArgs], {
    env,
    stdio: 'inherit',
    windowsHide: false,
  })
  child.on('error', (error) => fail(`failed to spawn: ${error.message}`))
  child.on('exit', (code, signal) => {
    if (signal !== null) {
      // Mirror the signal so the launcher dies with the child.
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 1)
  })
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
