# Website

The Cryozen Agent documentation site, built with [Docusaurus](https://docusaurus.io/).

> **Status: off until launch.** Cryozen Agent is in preview. GitHub Pages is not enabled, so none of
> the URLs under "Hosting layout" resolve, and `.github/workflows/deploy-site.yml` is skipped until
> the repository variable `DOCS_SITE_ENABLED` is `true`. The same variable gates the deploy that
> `skills-index.yml` triggers and the schedule of `skills-index-freshness.yml`, whose manual runs
> still probe. To launch: enable Pages with GitHub Actions as the source, set that variable, and
> rerun Deploy Site.

> **Reading the docs on GitHub?** The Markdown under `docs/` is authored for the rendered site.
> Cross-page links are relative Markdown paths, so they follow through on GitHub's file viewer too. Every page on the site has an **Edit this page** link
> that opens the source file here.

## Hosting layout

At launch, the site is a GitHub Pages project site for `cryozenai/cryozen-agent`, published by
`.github/workflows/deploy-site.yml`:

| URL | Source |
|---|---|
| `https://cryozenai.github.io/cryozen-agent/docs/` | this Docusaurus build (`baseUrl: '/cryozen-agent/docs/'`) |
| `https://cryozenai.github.io/cryozen-agent/install.sh` | `scripts/install.sh`, copied verbatim at deploy time |
| `https://cryozenai.github.io/cryozen-agent/install.ps1` | `scripts/install.ps1` |
| `https://cryozenai.github.io/cryozen-agent/install.cmd` | `scripts/install.cmd` |
| `https://cryozenai.github.io/cryozen-agent/llms.txt` | copy of the generated `llms.txt` |
| `https://cryozenai.github.io/cryozen-agent/` | a redirect page to `docs/` |

Because the docs live under a sub-path, never hardcode `/docs/...` or `/cryozen-agent/...` in React code.
Use `<Link to="/route">` for pages and `useBaseUrl('/api/x.json')` or `useBaseUrl('/img/x.png')` for static files.

## Authoring links in `docs/`

- Link to another page with a relative Markdown path, anchors included:
  `[Profiles](../user-guide/profiles.md)`, `[Bundles](../user-guide/features/skills.md#skill-bundles)`.
  Docusaurus turns the file path into the page route; GitHub follows the same path.
  Site routes (`/user-guide/profiles`) only work on the rendered site, because GitHub resolves them as repository paths and 404s.
- `python3 website/scripts/check_doc_links.py` fails on any route-style link in hand-authored pages; `--fix` rewrites them.
  It runs in the `Docs Site Checks` workflow.
  Generated pages (`user-guide/skills/{bundled,optional}`, `reference/*skills-catalog.md`) are
  produced by `scripts/generate-skill-docs.py`, which emits the same relative form.
- Images in MDX: `import useBaseUrl from '@docusaurus/useBaseUrl';` then `src={useBaseUrl('/img/...')}`.
  Plain Markdown images (`![alt](/img/...)`) are resolved by Docusaurus automatically.

## Installation

```bash
npm ci
```

## Local development

```bash
npm start
```

Starts a local development server with live reload.
`prestart`/`prebuild` run `scripts/prebuild.mjs`, which generates the skills, plugins, and `llms.txt` data (needs `python3` with PyYAML).

## Build

```bash
npm run build
```

Generates the static site into `build/`.
The build fails on broken links.

## Generated catalogs

Deploys regenerate these before building; run them locally after changing `skills/`, `optional-skills/`, or `plugin-catalog/`:

```bash
python3 website/scripts/extract-skills.py
python3 website/scripts/extract-plugins.py
python3 website/scripts/generate-skill-docs.py
```

## Diagram linting

CI runs `ascii-guard` to lint docs for ASCII box diagrams.
Use Mermaid (```` ```mermaid ````) or plain lists and tables instead of ASCII boxes to avoid CI failures.
