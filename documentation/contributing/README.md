# Contributing to doxa-maps

Welcome. You want to help build maps — edit colors, add a map, tune a legend — without
learning the whole architecture first. This folder is the **contributor entry point**; the
full guides live in the `documentation/` set and are linked below, so nothing here goes stale by
being duplicated.

## The one rule that keeps everything clean

> **Parameterized + genuinely reused by more than one map → the shared library**
> (`library/`, alias `@map`).
> **Not reused → it lives in your app-profile folder** (`plugin-designs/<your-map>/`).

"**Local by default, promote deliberately.**" When in doubt, keep your change local to your
own map; something graduates into the shared library only once a *second* map genuinely
needs it. Full reasoning — the promotion / orphan-audit rule — is in
[`../documentation/explanation.md`](../explanation.md).

## Start here

| You want to… | Read |
|---|---|
| Understand the whole picture (one library, many bundles, no rebuild) | [`../README.md`](../README.md) · [`../documentation/explanation.md`](../explanation.md) |
| Learn step-by-step with no jargon (non-coders welcome) | [`../documentation/tutorial.md`](../tutorial.md) |
| Do a task (add a map, embed, change colors, pick a CDN) | [`../documentation/how-to.md`](../how-to.md) |
| Look something up (file map, config fields, library index) | [`../documentation/reference.md`](../reference.md) |
| Understand build-vs-dev + partner-site embedding | [`../documentation/CONTRIBUTING.md`](../CONTRIBUTING.md) |
| Edit or add colors (the two places a color can live) | [`COLORS.md`](./COLORS.md) |

## Colors live here

[`COLORS.md`](./COLORS.md) is the beginner deep-dive on the **two places a color strategy
can live** — the shared `library/colors/` set vs your bundle's private
`plugin-designs/<bundle>/src/colors/` — and how the filename decides override-vs-add. The
strategy **contract** (the required `export default` shape) is in
[`../library/colors/README.md`](../../library/colors/README.md).
