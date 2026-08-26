import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = new URL('.', import.meta.url)
const instanceFiles = ['instances/native.json', 'instances/dashboard-dev.json', 'instances/dashboard.json']
const instances = await Promise.all(instanceFiles.map(async (file) => {
  const text = await readFile(new URL(file, root), 'utf8')
  return { file, ...JSON.parse(text) }
}))

const ports = new Set()
const homes = new Set()
const sources = new Map()
for (const instance of instances) {
  if (!Number.isInteger(instance.port) || instance.port < 1) throw new Error(`${instance.file}: invalid port`)
  if (ports.has(instance.port)) throw new Error(`${instance.file}: duplicate port ${instance.port}`)
  ports.add(instance.port)
  if (typeof instance.home !== 'string' || instance.home.length === 0) throw new Error(`${instance.file}: missing home`)
  const home = instance.home.replaceAll('\\', '/').toLowerCase()
  if (homes.has(home)) throw new Error(`${instance.file}: shared home ${instance.home}`)
  homes.add(home)
  if (instance.allowSharedHome !== false) throw new Error(`${instance.file}: allowSharedHome must be false`)
  if (typeof instance.sourceRoot !== 'string' || instance.sourceRoot.length === 0) throw new Error(`${instance.file}: missing sourceRoot`)
  sources.set(instance.id, instance.sourceRoot)
}

const native = instances.find((instance) => instance.id === 'native')
const dashboard = instances.find((instance) => instance.id === 'dashboard')
const dev = instances.find((instance) => instance.id === 'dashboard-dev')
if (native === undefined || dashboard === undefined || dev === undefined) throw new Error('required instances are missing')
if (native.sourceRoot === dashboard.sourceRoot) throw new Error('native and dashboard source roots must differ')
if (dashboard.port === dev.port) throw new Error('dashboard and dashboard-dev ports must differ')

console.log('isolation-config: PASS')
for (const instance of instances) {
  console.log(`${instance.id}: port=${instance.port} home=${instance.home} source=${instance.sourceRoot}`)
}
