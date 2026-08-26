#!/usr/bin/env node
/**
 * Runtime isolation verifier for DSH deployment instances (Windows compatible).
 *
 * Checks the deployment contract (ports unique, homes unique,
 * allowSharedHome=false, sourceRoot exists, expected bin exists) and then
 * inspects the CURRENT runtime: for every configured port that is listening,
 * it resolves the owning process command line and verifies the process is the
 * instance's expected DSH bin running with `--port <port>`. When the mapping
 * cannot be confirmed (listener present but PID/command line unavailable, or
 * command line mismatch), the check FAILS explicitly. The tool is read-only:
 * it never stops, restarts, or launches anything.
 *
 * Usage:
 *   node verify-runtime-isolation.mjs
 *
 * Exit codes: 0 = config valid and every running instance matches its mapping,
 * 1 = contract violation or unverifiable/mismatched runtime.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import net from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const deploymentRoot = resolve(dirname(fileURLToPath(import.meta.url)))
const instancesDir = resolve(deploymentRoot, 'instances')
const INSTANCE_IDS = ['native', 'dashboard-dev', 'dashboard']

function fail(message) {
  console.error(`[verify-runtime-isolation] FAIL: ${message}`)
  process.exit(1)
}

function normalizeKey(value) {
  return String(value).replaceAll('\\', '/').toLowerCase()
}

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

function expectedBin(instance) {
  const relative = instance.shell === 'dashboard' ? 'apps/cli/lib/bin.js' : 'lib/bin.js'
  const bin = resolve(instance.sourceRoot, relative)
  if (!existsSync(bin)) fail(`${instance.file}: expected bin not found: ${bin}`)
  return bin
}

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

/**
 * Resolve the owning PID for a listening port. netstat is primary (reliable on
 * this host); PowerShell Get-NetTCPConnection is a fallback.
 */
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

/** Resolve the command line for a PID. wmic is primary; PowerShell CIM is a fallback. */
function processCommandLine(pid) {
  return new Promise((done) => {
    execFile('wmic.exe', ['process', 'where', `ProcessId=${pid}`, 'get', 'commandline', '/value'], {
      timeout: 5000, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
    }, (wmicError, wmicOut) => {
      if (!wmicError) {
        const match = /CommandLine=(.*)$/m.exec(String(wmicOut))
        if (match !== null && match[1] !== undefined) {
          const value = match[1].trim()
          if (value.length > 0) return done(value)
        }
      }
      const psCmd = `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object -First 1 -ExpandProperty CommandLine)`
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCmd], {
        timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024,
      }, (error, stdout) => {
        if (error) return done(undefined)
        const text = String(stdout).trim()
        done(text.length > 0 ? text : undefined)
      })
    })
  })
}

function commandLineMatches(expectedBin, port, commandLine) {
  const line = commandLine.toLowerCase()
  const bin = expectedBin.toLowerCase()
  const portFlag = new RegExp(`--port[=\\s]+${port}(\\s|$)`).test(commandLine)
  return line.includes(bin) && portFlag
}

async function main() {
  const instances = await loadInstances()
  let failures = 0

  console.log('[verify-runtime-isolation] config contract: PASS')
  for (const instance of instances) {
    console.log(`  ${instance.id}: port=${instance.port} home=${instance.home} shell=${instance.shell}`)
  }
  console.log('')

  for (const instance of instances) {
    const bin = expectedBin(instance)
    if (!(await isPortListening(instance.port))) {
      console.log(`[verify-runtime-isolation] ${instance.id}: port ${instance.port} NOT listening (not running)`)
      continue
    }
    const pid = await owningPid(instance.port)
    if (pid === undefined) {
      failures += 1
      console.error(`[verify-runtime-isolation] FAIL ${instance.id}: port ${instance.port} is listening but the owning PID could not be determined — cannot confirm isolation`)
      continue
    }
    const commandLine = await processCommandLine(pid)
    if (commandLine === undefined || commandLine.length === 0) {
      failures += 1
      console.error(`[verify-runtime-isolation] FAIL ${instance.id}: port ${instance.port} is owned by PID ${pid} but its command line could not be determined — cannot confirm isolation`)
      continue
    }
    if (!commandLineMatches(bin, instance.port, commandLine)) {
      failures += 1
      console.error(`[verify-runtime-isolation] FAIL ${instance.id}: port ${instance.port} (PID ${pid}) does not match the expected instance mapping`)
      console.error(`    expected bin: ${bin}`)
      console.error(`    actual cmd : ${commandLine}`)
      continue
    }
    console.log(`[verify-runtime-isolation] ${instance.id}: port ${instance.port} (PID ${pid}) matches expected bin and --port ${instance.port}`)
  }

  console.log('')
  if (failures > 0) {
    console.error(`[verify-runtime-isolation] RESULT: FAIL (${failures} runtime mismatch/unverifiable)`)
    process.exit(1)
  }
  console.log('[verify-runtime-isolation] RESULT: PASS (every running instance matches its mapping)')
  console.log('note: DSH_HOME is launch-time environment and cannot be read from a process command line;')
  console.log('      runtime home isolation is enforced by run-instance.mjs at launch and by this check at config level.')
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
