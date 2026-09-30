# Deploying dx-maps — the 4 ways it ships

dx-maps is one repo that runs in four places. Two are for **building** maps (your laptop, a shared
cloud dev server); two are for **showing** them (public embeds, a folder inside your own site). The
building ones run the live source with hot reload; the showing ones serve the **built** folder,
`dx-maps/`, which is checked for private files before it is published.

| # | Where | For | What you run | What you get |
|---|---|---|---|---|
| 1 | **Your laptop** | building, alone or with a team | `bun run dev` | the Plugin Studio at http://localhost:5173 |
| 2 | **A shared cloud dev server** | a team, or an agent on a server | the Docker image in `deployment/cloud/` | the Plugin Studio at `https://<your-host>/`, behind your team's sign-in |
| 3 | **Public embeds** | other sites showing a map | the built `dx-maps/` folder on `/cdn` or any static host | `https://<host>/…/dx-maps/<plugin>/<profile>/index.html` and `…/<plugin>/<plugin>.js` |
| 4 | **Inside your own site** | one site hosting every map | copy `dx-maps/` into the site's `public/` | the maps at `https://<your-site>/<folder>/…` |

---

## 1. Your laptop — `bun run dev`

```bash
git clone --depth 1 https://git.nuxtbase.app/doxa-open/doxa-maps.git
cd doxa-maps
bun install --frozen-lockfile
bun run dev          # → http://localhost:5173/  is the Plugin Studio
```

Zero config: no `.env` is needed. Everything is local by default — hot reload of your own edits, a local
PocketBase at `/api/pb`, and Rudder's voice engine once it is set up (Go 1.22+, then
`bash backend/rudder-engine/setup-runtime.sh`). Every setting, with its default,
is in [`.env.example`](../.env.example); an empty value means the default.

- Follow what teammates land on a shared branch: set `DX_SYNC_REMOTE` (a remote name or a repo URL).
- Use the team's shared PocketBase instead of a local one: set `DX_PB_URL`.

Details: [HOWTO-join-the-table.md](./HOWTO-join-the-table.md).

## 2. A shared cloud dev server — Docker or Coolify, with `/data`

One running copy of the Plugin Studio that follows a branch and hot-reloads every push, for a whole team
or for an agent that lives on a server. Nobody edits files on it: changes arrive by pushing.

```bash
docker build -t dx-maps-dev deployment/cloud
docker run -d -p 5173:5173 -v dx-maps-data:/data \
  -e REPO_URL=https://<host>/<owner>/<repo>.git -e BRANCH=main dx-maps-dev
```

Or paste `deployment/cloud/Dockerfile` into a container host (Coolify's "Dockerfile" build pack) and give
it a domain.

- **Give it a persistent `/data` volume.** It holds the team PocketBase (dev and prod) and the last
  published build. Without one, every restart or redeploy starts empty.
- **Put the sign-in in front** before it is reachable from the internet: the `OIDC_*` settings. Only the
  groups you allow get in.
- About **2.5 GB of memory and 2 vCPUs**.

It also serves the **team PocketBase** at `/pb/` and, after an admin triggers a build, the **public
embed folder** at `/cdn/` (way 3).

Details: [deployment/cloud/README.md](../deployment/cloud/README.md) and
[CLOUD-DEVELOPMENT-ENVIRONMENT.md](./CLOUD-DEVELOPMENT-ENVIRONMENT.md).

## 3. Public embeds — `/cdn` or any static host

The built folder, `dx-maps/`, is what other sites embed. Every link inside it is relative, so it works
from any address.

- **From the cloud dev server:** `/cdn/` serves the **`production`** branch, never `main`. `main` is the
  shared sandbox where everyone lands all day; `production` moves only when you decide the current state
  is ready to be public. The container notices when `production` moves and rebuilds `/cdn` by itself
  (about 2 minutes after the move, then about 2 minutes to build). Each build removes private files,
  refuses to publish if any remain, keeps the last good build if anything fails, and swaps
  `/cdn/dx-maps/` over atomically. `/cdn/` is public (no sign-in) and sends
  `Access-Control-Allow-Origin: *`, so both iframes and JS embeds work on other sites.

  **To publish (promote main to production)**, once the checks pass on the commit you want public:

  ```bash
  git fetch origin && git checkout main && git merge --ff-only origin/main
  bun run gates:pre                   # the checks must pass on exactly this commit
  git push origin main:production     # /cdn follows within a few minutes
  ```

  An admin can also rebuild at once (`POST /admin/build`), and `/admin/status` shows what `/cdn` serves
  and what `production` points at.
- **On any static host:** build locally with `BUILD_ALLOW=1 bun run build` and upload `public/dx-maps/`.
  For JS embeds on other sites, the host must send `Access-Control-Allow-Origin: *`.

Every page loads its script with an integrity hash, so a tampered or stale script is refused by the
browser. The Plugin Studio's "copy embed" gives you the iframe and the script snippet for each map.

Details, per host (Cloudflare Pages, jsDelivr, any web server) and per embed style:
[README — What the build makes](../README.md#what-the-build-makes--3-outputs) and
[README-SECTION-3-cli-commands.md](./README-SECTION-3-cli-commands.md).

## 4. Inside your own site — the folder in `public/`

Copy the built `dx-maps/` folder into your site's `public/` (renaming it is fine) and your site becomes
the host: no second server and no cross-site setup, because the maps and the page share one origin.

**Live example:** the DX-life branch
[`research-gallery`](https://git.nuxtbase.app/doxa-life/doxa-maps-cdn/src/branch/research-gallery)
drops the folder into DX-life's `public/` and fills `/research` with the Research Gallery. Run it with
`bun install && bun run dev`, then open `/research/`.

---

**Which one?** Building maps: **1**, plus **2** if several people or agents work together. Showing maps
on other sites: **3**. Showing them on a site you already run: **4**.
