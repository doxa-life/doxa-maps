# How to join the table

You want to build a map. Someone told you there is a repo, a dev server, and a thing called PocketBase, and
now you are staring at three of them wondering which one you are supposed to touch.

Short answer: **you work on your laptop, you land your work on main, and a shared server shows everyone what
landed.** That is the whole shape. The rest of this page is what each of those three is for, and the five
commands you actually type.

> **This page is about working alongside other people.** If you want to know how to build a plugin itself —
> the files, the build, getting it live — read
> [develop-a-plugin-and-see-it-live.md](./develop-a-plugin-and-see-it-live.md) first and come back here when
> you are ready to share your work.

---

## The three places

### 1. Your laptop — the workshop

This is where you build. Everything is local and fast, and nothing you do here can affect anyone else.

```bash
bun install
bun run dev
```

That is the whole setup. **Nothing to configure**, no server to reach, no Docker. You get the Plugin
Studio, dictation, hot reload on your own edits, and a local database with your own test data. Break it,
reset it, fill it with nonsense — it is yours.

If your coding agent runs on a server rather than on your laptop, there is a second way to work —
see [CLOUD-DEVELOPMENT-ENVIRONMENT.md](./CLOUD-DEVELOPMENT-ENVIRONMENT.md). Most people do not need it.

### 2. `main` — the truth

When your work is ready, it goes to `main`. That is the one place everybody agrees on. Nothing is "real"
until it is there.

### 3. The shared dev server — the table

A server watches `main` and reloads about every 15 seconds. That is where the team sees each other's work without
anyone sending anyone a zip file. You do not edit here. You never need to log into it to do your job.

> **The rule that makes this work:** one plugin folder per person. You edit `plugin-designs/<your-plugin>/`
> and nobody else does. Everything below depends on that.

---

## Getting your work onto main

Three commands, in this order, every time:

```bash
git add -A && git commit -m "what you changed"
git pull --rebase origin main
git push origin HEAD:main
```

If the push is rejected, someone landed first. Run the middle command again and push again. That is not an
error — it is the normal case, and it is worth knowing how normal.

**We measured it.** In a ten-writer stress test at a far faster edit rate than a human works at:

| | |
|---|---|
| pushes rejected, then retried | **95%** |
| merge conflicts | **0** |
| retries needed per edit | 1.1 average, 3 at worst |

Nearly every push got rejected. **Not one caused a conflict.** That is the one-folder-each rule paying off:
you are all pushing to the same branch, so you collide on *who goes first* — but never on the same lines of
code, because you are never in the same file. A rejected push costs you one extra command. It does not cost
you an afternoon untangling someone else's work.

If you *do* hit a real conflict, it means two people edited one file. Stop and talk to the other person;
that is a coordination problem, not a git problem.

---

## Seeing your teammates' work on your laptop (optional)

By default your laptop only reloads on *your* edits. If you want teammates' landed work to arrive
automatically while `bun run dev` is running, copy `.env.example` to `.env.local` at the repo root and set:

```
DX_SYNC_REMOTE=origin
```

That is the only line you need. `.env.local` is never committed, so it stays yours.

> **Either a remote name or a full repo URL works.** `origin` is what almost everyone wants. A URL —
> `https://…/your-repo.git` — works too and saves you a `git remote add`; if the repo is private it uses
> the git credentials your laptop already has. Leave it unset and the whole feature is off.
>
> If you do put a token in the URL (`https://user:token@…`), it is never written to the log or shown at
> `/api/dev-sync`.

Two optional dials, if you want them:

| | what it does | default |
|---|---|---|
| `DX_SYNC_BRANCH` | which branch to follow | `main` |
| `DX_SYNC_INTERVAL` | seconds between checks | `5` (minimum 2) |

**It only pulls when it is completely safe to.** All three must be true: you are on that branch, you have no
unsaved edits, and you have no local commits. If any one of them is not, it does not touch your files —
it tells you instead, in the dev server log:

```
main is 3 commits ahead … pull when ready
```

So it cannot surprise you mid-thought. You can also check that any time at `/api/dev-sync`.

---

## The database, and the one thing that surprises people

There are three databases. You work against one of the first two — never the third.

| Where | What is in it | Who touches it |
|---|---|---|
| Your laptop | your own sandbox data | you, freely — **this is the default** |
| The team's shared one | the team's shared test data | the team — opt-in, see below |
| Production | what the public sees | nobody directly |

**You never publish a database.** Not yours, not anyone's. What travels is the *shape* — the tables and
fields — as migration files committed to the repo, in `backend/pocketbase/pb_migrations/`.

So adding a field is a normal change: you edit, you commit the migration, you push it like any other file,
and it goes through review with everything else. When the person who publishes runs the publish step, the
migrations apply.

This is deliberate. A database rule that opens something to the public arrives as **a commit someone can
read** rather than as a setting somebody clicked at midnight. If you have ever inherited a system where the
live config did not match the repo, you already know why.

### Which one your laptop talks to

**By default, your own.** You do not configure anything. The first time you run `bun run dev` it starts a
database on your laptop, keeps its data in `.pb/`, and gives you an admin screen at `/api/pb/_/`. A fresh
clone plus `bun run dev` is the whole setup — no remote server, no Docker, nothing to sign into.

If your team wants everyone working against the *same* test data instead, that is opt-in. Add one line to
`.env.local`:

```
DX_PB_URL=https://<your team's dev server>/pb
```

You sign in with the same team account you use for everything else — there is no separate password. Ask
whoever set up your team for the address. Leave the line out and you stay on your own local one, which is
the right place to be while you are finding your feet.

The only other thing here is `DX_PB_PORT`, which you set only if the log says port 8090 is already in use.

> **New collections start locked.** Your plugin's data is not readable until a migration opens it —
> deliberately, so nothing is public by accident. That migration is a commit like any other.

---

## One more thing to set

Copy `.env.example` to `.env.local`. **Every line in it is optional** — empty means the default, which is
the all-local setup described above. You can start with none of them filled in.

The one you will probably want is a Mapbox token, which is the single credential you have to ask the team
for:

```
VITE_MAPBOX_TOKEN=<ask the team>
```

Leave it empty and the Mapbox-backed maps will not draw; you can also work with the keyless MapLibre
provider instead.

---

## The five things to remember

1. **Build on your laptop.** It is fast and it is yours.
2. **One plugin folder per person.** This is what keeps ten people out of each other's way.
3. **`pull --rebase`, then push.** A rejected push is normal — 95% of them were, and none became conflicts.
4. **The shared server is for looking, not editing.**
5. **Schema is a commit, never a click.** You never publish a database.

---

## When something is wrong

- **"Your push was rejected"** — normal. `git pull --rebase origin main`, push again.
- **A real merge conflict** — two people edited one file. Talk to them; the one-folder rule slipped.
- **Your change is not on the shared server** — it reloads about every 15 seconds, not instantly. Check your
  push actually landed: `git log origin/main -1`.
- **The shared server shows an old version of your plugin** — you are probably looking at what is on `main`,
  not what is on your laptop. Those are different on purpose.
