# Run dx-maps in the cloud: one shared dev server for a team

One container runs the Plugin Studio with hot reload for everyone. It clones the repo, pulls the
branch every few seconds, and Vite hot-reloads whatever changed, so every change an agent lands
on `main` shows up in everyone's browser within seconds. No rebuild; `bun run build` is only for
publishing.

With **no OIDC settings** it runs open, like `bun run dev` on a laptop. With **OIDC settings** a
sign-in page ("Sign in with *your provider*") sits in front of everything: the Studio, every map,
and the hot-reload websocket. Only people in the allowed groups get in.

## Deploy

1. Build the image from [`Dockerfile`](./Dockerfile). It's a small bootstrap (Bun, git, and the
   [oauth2-proxy](https://github.com/oauth2-proxy/oauth2-proxy) binary); at start it clones the repo
   and runs [`entry.sh`](./entry.sh) from it, so the recipe updates with the repo. Paste it into any
   container host (Coolify's "Dockerfile" build pack, Railway, `docker build`).
2. Set the environment below and expose the container's `PORT` over HTTPS.
3. Give it about 2 GB of memory (Vite plus the dependency install).

| Variable | Needed | Meaning |
|---|---|---|
| `REPO_URL` | yes | the dx-maps git URL to clone |
| `BRANCH` | no (`main`) | the branch to follow |
| `PULL_INTERVAL` | no (`15`) | seconds between pulls |
| `GIT_TOKEN` | private repos | a read token for the clone and pulls |
| `PORT` | no (`5173`) | the port the container serves on |
| `HMR_CLIENT_PORT`, `HMR_PROTOCOL` | behind HTTPS | `443` and `wss`, so browsers reach the hot-reload websocket |

## Sign-in (optional)

Set all of these to turn the gate on. Register a **confidential** client at your OIDC provider
with the redirect URL `https://<your-host>/oauth2/callback`; PKCE (S256) is used as well.

| Variable | Meaning |
|---|---|
| `OIDC_ISSUER` | the provider's issuer URL (its `/.well-known/openid-configuration` must resolve) |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | the registered client |
| `OIDC_REDIRECT_URL` | `https://<your-host>/oauth2/callback` |
| `OIDC_ALLOWED_GROUPS` | comma-separated groups allowed in; **required** (the server refuses to start without it, because many providers allow open sign-up) |
| `OIDC_DISPLAY_NAME` | the name on the button, e.g. "Sign in with *Acme*" |
| `OIDC_GROUPS_CLAIM` | the token claim holding groups (default `groups`) |
| `OIDC_COOKIE_SECRET` | 32 characters; keeps people signed in across restarts (random if unset) |

Secrets reach oauth2-proxy through its environment, never its command line.

## Backend and production (v1, experimental)

With the sign-in on, the container also runs PocketBase and can publish a production build:

| Route | Who | What |
|---|---|---|
| `/` | signed-in | the dev server (Plugin Studio, hot reload) |
| `/pb/` | signed-in (its `/_/` dashboard: `OIDC_ADMIN_GROUPS` only). With `PB_OIDC_CLIENT_SECRET`, its `/api/` is public and PocketBase signs people in itself (see below); `_superusers` and system collections stay admin-only | PocketBase **dev**, the team's shared backend |
| `/api-prod/api/` | **public** | PocketBase **prod**'s API; its dashboard is never exposed |
| `/cdn/dx-maps/` | **public** | the last published build: `manifest.json` at a stable URL, CORS open for embeds |
| `POST /admin/build` · `GET /admin/status` | `OIDC_ADMIN_GROUPS` only | build and publish the pulled commit |

A build runs one at a time (a second gets `409`), on a snapshot of the pulled commit, with Node's heap
capped. It removes everything in [`public-exclusions.txt`](./public-exclusions.txt) **before**
building, checks the output again afterwards, and refuses to publish if anything excluded is still
there. Only then does it swap the new build in.

| Variable | Meaning |
|---|---|
| `OIDC_ADMIN_GROUPS` | comma-separated groups allowed to build and to open PocketBase's dashboard |
| `PB_SUPERUSER_EMAIL`, `PB_SUPERUSER_PASSWORD` | PocketBase's superuser, set on start in both instances |
| `PB_OIDC_CLIENT_SECRET` (+ `PB_OIDC_CLIENT_ID`, default `dx-maps-pb-dev`) | turns pb-dev into the team backend: laptops use it directly (`DX_PB_URL=https://<host>/pb`), and people sign in to PocketBase through the same OIDC provider, with its own client whose redirect URI is `https://<host>/pb/api/oauth2-redirect`. Only members of `OIDC_ALLOWED_GROUPS` get in (a sign-in hook baked into the image and pinned; the repo's own hooks never run). Password sign-in is off, new collections are superuser-only until a migration opens them, and data never leaves `/data` |
| `PRODUCTION_BRANCH` | the branch `/cdn/` is built from (default `production`); the dev server keeps following `BRANCH`. Promote with `git push origin main:production` |
| `CDN_AUTOBUILD_MINUTES` | rebuild `/cdn/` by itself once `PRODUCTION_BRANCH` has held a new commit this long (default `2`; `0` = only the admin button) |
| `SUBDOMAIN_APPS` | publish plugins as their own PUBLIC sites: `host=bundle/profile`, comma-separated, e.g. `research-gallery.example.org=doxa-maps-spa/doxa-maps-spa`. Served from the `/cdn` build by a separate server on `SUBDOMAIN_PORT` (default `5176`) that answers only those hosts and only with published files; point each host's proxy route at that port. No sign-in is skipped anywhere else |
| `PUBLIC_API_BASE` | the public API URL written into the build's `runtime-config.js` (e.g. `https://<host>/api-prod`) |
| `BUILD_MAX_OLD_SPACE_MB` | Node heap cap for a build (default `1536`) |
| `RUDDER_ENGINE` | `1` runs Rudder's voice-to-text engine here, fed by the browser's microphone (about 1 GB more; its runtime and model, ~742 MB, are baked into the image at `/opt/rudder`, and `/data/rudder` wins when it holds a model). The site serves at once; Rudder shows "starting" until its engine is built, then the dev server restarts once to start it. Give the container at least 2 vCPUs, or transcription falls behind speech |
| `RUDDER_ALLOW_HOST` | every public host the engine accepts, comma-separated (it refuses others, so list each domain the container answers on); defaults to Coolify's `COOLIFY_FQDN`, else the host in `OIDC_REDIRECT_URL` |

Mount a persistent volume at **`/data`** (PocketBase data and published builds). Memory measured on
the running container: about 0.45 GB idle, up to about 1.5 GB more during a build, so give it
**2.5 GB** (**3.5 GB** with `RUDDER_ENGINE=1`).
