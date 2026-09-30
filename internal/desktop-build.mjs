#!/usr/bin/env node
/**
 * desktop-build — `bun run desktop:build <plugin>`: package ONE desktop plugin as a desktop app (Tauri).
 *
 * Only a plugin whose <profile>.meta.json "targets" include "desktop" can be packaged (plugin-targets.mjs).
 * Nothing here touches public/ or the committed tree:
 *   1. the plugin's bundle is built into .desktop/<plugin>/ (DOXA_OUT_ROOT), with a one-element page that
 *      tells it where its engine listens;
 *   2. the plugin's engine, when its meta names one ("backend": "backend/<name>", Go), is built for this
 *      machine as deployment/src-tauri/binaries/<name>-<target triple>, Tauri's sidecar layout;
 *   3. `tauri build` runs with a --config override that points the window at that page, names the app,
 *      and bundles the sidecar; deployment/src-tauri/tauri.conf.json itself is not edited.
 * The shell (deployment/src-tauri/src/main.rs) starts the sidecar with RUDDER_AUDIO=browser and
 * RUDDER_HOME=<app data dir>/rudder, and stops it when the window closes.
 * See documentation/HOWTO-build-the-desktop-app.md for prerequisites and what is still unproven.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { desktopProfile } from './plugin-targets.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TAURI_DIR = join(ROOT, 'deployment', 'src-tauri')
const plugin = process.argv[2]
const die = (m) => { console.error('desktop:build: ' + m); process.exit(1) }
const run = (cmd, args, opts = {}) => {
  console.log('→ ' + [cmd, ...args].join(' '))
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts, env: { ...process.env, ...(opts.env || {}) } })
  if (r.status !== 0) die(`${cmd} failed (exit ${r.status})`)
}

if (!plugin) die('usage: bun run desktop:build <plugin>   (a plugin-designs/<plugin>/ whose meta targets include "desktop")')
const dir = join(ROOT, 'plugin-designs', plugin)
if (!existsSync(dir)) die(`no plugin-designs/${plugin}/`)
const dp = desktopProfile(dir)
if (!dp) die(`${plugin} does not declare "desktop" in any <profile>.meta.json "targets"; it is not a desktop plugin`)

// 1. The plugin, built outside public/.
const stage = join(ROOT, '.desktop', plugin)
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
run('bun', ['x', 'vite', 'build'], { env: { BUNDLE: plugin, DOXA_OUT_ROOT: stage } })
const tag = dp.meta.element || plugin
const port = Number(process.env.RUDDER_PORT || 5193)
const name = String(dp.meta.label || plugin).split(/\s+[—–-]\s+/)[0].trim() || plugin
const cfg = { apiBase: `http://127.0.0.1:${port}/api/rudder` }
writeFileSync(join(stage, 'index.html'), `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title><style>html,body{margin:0;height:100%;background:#0b0f14}</style></head>
<body><${tag} profile-config='${JSON.stringify(cfg)}' style="display:block;height:100vh"></${tag}>
<script src="${plugin}/${plugin}.js"></script></body></html>
`)

// 2. The engine, when the plugin has one.
const externalBin = []
const backend = dp.meta.backend
if (backend) {
  const src = join(ROOT, backend)
  const sidecar = backend.split('/').filter(Boolean).pop()
  if (!existsSync(src)) die(`meta names backend "${backend}" but that folder does not exist`)
  const vv = spawnSync('rustc', ['-vV'], { encoding: 'utf8' })
  const triple = ((vv.stdout || '').match(/^host:\s*(\S+)/m) || [])[1]
  if (!triple) die('rustc not found: install Rust (https://rustup.rs) to build a desktop app')
  const exe = process.platform === 'win32' ? '.exe' : ''
  mkdirSync(join(TAURI_DIR, 'binaries'), { recursive: true })
  run('go', ['build', '-o', join(TAURI_DIR, 'binaries', `${sidecar}-${triple}${exe}`), '.'], { cwd: src })
  externalBin.push(`binaries/${sidecar}`)
}

// 3. The app.
const targets = process.platform === 'darwin' ? ['dmg'] : process.platform === 'win32' ? ['nsis'] : ['deb']
const override = {
  productName: name,
  identifier: `life.doxa.${plugin.replace(/[^a-z0-9]+/gi, '')}`,
  build: { frontendDist: relative(TAURI_DIR, stage) },
  app: { windows: [{ title: name, width: 760, height: 820, minWidth: 360, minHeight: 480, resizable: true, url: 'index.html' }] },
  bundle: { active: true, targets, ...(externalBin.length ? { externalBin } : {}) },
}
run(join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tauri.cmd' : 'tauri'), ['build', '--config', JSON.stringify(override)])

const bundleDir = join(process.env.CARGO_TARGET_DIR ? resolve(process.env.CARGO_TARGET_DIR) : join(TAURI_DIR, 'target'), 'release', 'bundle')
const found = existsSync(bundleDir) ? readdirSync(bundleDir).flatMap((d) => readdirSync(join(bundleDir, d)).map((f) => join(bundleDir, d, f))) : []
console.log(`\ndesktop:build ${plugin}: done. Installer(s):\n` + (found.length ? found.map((f) => '  ' + f).join('\n') : `  (none found under ${bundleDir})`))
