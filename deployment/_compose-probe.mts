// One-off probe (temporary): compose base+surface+overlay patches over an
// empty root, exactly as the web e2e scaffold does, and print the ui-* rows.
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { applyEntryPatches } from '@deepseek-ai/cordis-plugin-include'
import { join } from 'node:path'

const ROOT = 'H:/AIWork/dsh-fork'
const basePatches = loadOverlayPatches('probe', join(ROOT, 'packages/bundle/base/cordis.patch.yml'))
const surfacePatches = loadOverlayPatches('probe', join(ROOT, 'packages/bundle/web-app/cordis.patch.yml'))
const extraOverlayPatches = loadOverlayPatches('probe', join(ROOT, 'packages/bundle/web-app/dashboard.patch.yml'))

const result = applyEntryPatches([], [...basePatches, ...surfacePatches, ...extraOverlayPatches], (m, ...a) => console.log('warn:', m, ...a))

for (const row of result) {
  if (row.id === 'ui-layout' || row.id === 'ui-dashboard-shell' || row.id === 'ui-sidebar' || row.id === 'ui-conversation') {
    console.log(JSON.stringify(row))
  }
}
