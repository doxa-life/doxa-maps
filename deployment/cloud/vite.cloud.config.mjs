// Overlay for the cloud dev server: the repo's own vite.config.js plus what a shared, public
// host needs. Every value comes from the environment (see deployment/cloud/README.md).
import base from '/app/repo/vite.config.js'
import { mergeConfig } from 'vite'
import { readFileSync } from 'node:fs'

const env = process.env
const SETUP_STATE = '/tmp/rudder-setup.state'   // written by entry.sh: running -> done | failed
const setupState = () => { try { return readFileSync(SETUP_STATE, 'utf8').trim() } catch { return '' } }

// Rudder's setup runs in the background (entry.sh), so the site serves before the engine exists. While it
// runs, /api/rudder answers "starting" (the widget shows "Loading speech model…"; /events is held open so it
// does not retry in a loop). When setup ends, the dev server restarts ONCE: the repo's backend plugin only
// looks for the engine binary at start, and the restart is what starts it. 'pre' puts this ahead of that
// plugin's own "engine offline" answer.
const rudderStarting = {
  name: 'cloud-rudder-starting',
  enforce: 'pre',
  apply: 'serve',
  configureServer(server) {
    if (setupState() !== 'running') return
    server.middlewares.use('/api/rudder', (req, res, next) => {
      if (setupState() !== 'running') return next()
      const status = { engine: 'starting', error: '', audio: 'browser' }
      if ((req.url || '').startsWith('/events')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
        res.write(`data: ${JSON.stringify({ type: 'status', status })}\n\n`)
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(status))
    })
    const poll = setInterval(() => {
      if (setupState() === 'running') return
      clearInterval(poll)
      server.config.logger.info(`[rudder] setup ${setupState() || 'ended'}: restarting the dev server to start the engine`)
      server.restart()
    }, 2000)
    server.httpServer?.once('close', () => clearInterval(poll))
  },
}

export default async (e) => {
  const b = typeof base === 'function' ? await base(e) : base
  const hmr = env.HMR_CLIENT_PORT
    ? { clientPort: Number(env.HMR_CLIENT_PORT), protocol: env.HMR_PROTOCOL || 'wss' }
    : undefined
  return mergeConfig(b, {
    plugins: [rudderStarting],
    cacheDir: '/tmp/vite-cache',
    server: {
      host: env.VITE_HOST || '0.0.0.0',
      port: Number(env.VITE_PORT || 5173),
      strictPort: true,
      allowedHosts: true,
      ...(hmr ? { hmr } : {}),
    },
  })
}
