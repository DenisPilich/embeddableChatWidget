# Embeddable Chat Widget

An embeddable chat widget: the site owner adds a single `<script>` line and gets a chat window on their page, where an LLM answers by default and a human operator joins only when needed.

> **Status: phases 1 and 2 are complete.** The widget is published on npm and talks to a live backend. Phase 3 replaces the canned assistant with a real model.

## Why this project

Chat widgets are not in short supply, and this is not an attempt to replace them. The project is a verifiable demonstration of two things:

1. **Third-party code can live on someone else's page without breaking it.** Shadow DOM isolation, a bundle measured in kilobytes, and resilience to hostile CSS, strict Content Security Policy, SPA routing and legacy jQuery pages.
2. **A full real-world multi-tenant SaaS stack:** tenant data isolation, realtime with automatic fallback, streamed LLM output with spend control, and a reproducible release process.

## What the demo shows

Click a button on a third-party page → a chat window opens → an answer arrives within seconds. No sign-up, no "operator offline".

Today that answer comes from a canned assistant. Phase 3 puts a real model behind the same interface, and nothing else has to change.

## Stack

| Layer | Technology |
|---|---|
| Widget | TypeScript, Vite (library mode), Shadow DOM, no framework |
| Dashboard & API | Next.js, TypeScript, Tailwind, shadcn/ui |
| Data | PostgreSQL (Neon), Prisma |
| Realtime | Polling → SSE → push layer (decision deferred) |
| AI | Groq behind a provider interface, streamed over SSE |
| Layout | Monorepo, pnpm workspaces |
| Delivery | npm → jsDelivr, version pinned in the URL |

## Documentation

- **[docs/PLAN.md](docs/PLAN.md)** — phases, exit criteria, risks, and what we deliberately left out.
- **[docs/DECISIONS.md](docs/DECISIONS.md)** — architecture decision log: context, alternatives, consequences.

## Development

After cloning, create the secrets file once. The build fails without it, because the Prisma CLI validates its variables on every run.

```powershell
Copy-Item apps\web\.env.example apps\web\.env
```

The values inside are placeholders. They are enough for builds, checks and end-to-end tests; talking to a real database needs real connection strings.

```bash
pnpm install        # dependencies for every workspace package
pnpm dev            # build the widget and serve the "customer site" stands on http://localhost:5173
pnpm --filter @ecw/web dev   # backend on http://localhost:3000
pnpm build          # build every package
pnpm typecheck      # type-check
pnpm lint           # lint, including rules that need type information
pnpm lint:fix       # the same, fixing what can be fixed automatically
pnpm format         # format the code
pnpm format:check   # check formatting without changing anything
pnpm verify         # everything at once: types, lint, format, build, size budget
pnpm size           # bundle size budget only
pnpm test:e2e       # end-to-end tests in a real browser
```

Markdown is excluded from formatting on purpose: Prettier rewrites tables into wide aligned columns, which makes the source unpleasant to read. The reason is recorded in `.prettierignore` itself.

### Fixture stands

The stands in `apps/fixtures` imitate a customer site and serve the built files at the same paths a CDN would — `/ecw-loader.iife.js` and `/ecw-widget.iife.js`. They load the loader, exactly as a customer would.

| Stand page | What it checks |
|---|---|
| `/` | A normal page: style isolation. The serif font is bait — if the widget's text comes out with serifs, inherited properties are not reset correctly |
| `/transform-body.html` | `transform` on `<body>`: the widget must not drift out of the viewport corner while scrolling |
| `/hostile.html` | Hostile CSS: foreign `!important` on everything, scrolling disabled, a foreign layer with an enormous `z-index` |
| `/csp.html` | Strict Content Security Policy: inline styles and scripts are forbidden |
| `/spa.html` | Single-page app: container content replaced and `init` called again on navigation |

The stands talk to a **test double** rather than the real backend. It lives inside the stand (`apps/fixtures/stub-api.ts`) and keeps messages in memory, so the widget tests run without a database, without secrets and without the network. The real backend is covered separately: `apps/fixtures/e2e/api.spec.ts` runs against Next.js and a real database, and is skipped when there is none.

To try the widget against the real backend, point `data-ecw-api` in the stand's script tag at `http://localhost:3000` and start the backend.

The stands are covered by Playwright tests (`apps/fixtures/e2e`). They check that the widget appears, opens and closes, sends a message and receives an answer, that styles stay isolated in both directions, that a transformed `body` does not break positioning, that focus is trapped and restored, and that markup in a visitor's message is never executed. The tests run on the system Chrome, so no browser download is required.

## How it gets embedded

```html
<script
  src="https://cdn.jsdelivr.net/npm/ecw-widget@0.1.2/dist/ecw-loader.iife.js"
  data-site-id="site_123"
  async
></script>
```

The loader weighs 678 bytes gzipped: it waits for the customer's page to finish loading and only then pulls in the main file (7.9 KB gzipped). The widget therefore never lands on the critical path of someone else's page — and search engines rank that page by its loading metrics.

**The version in the URL is mandatory.** Without it, the next package release would silently change the widget on every site it is already embedded in.

### Backend address

By default the widget calls the address baked in at build time. Self-hosters can override it on the page or at build time:

```html
<script
  src="https://cdn.jsdelivr.net/npm/ecw-widget@0.1.2/dist/ecw-loader.iife.js"
  data-site-id="site_123"
  data-ecw-api="https://chat.example.com"
  async
></script>
```

```powershell
$env:ECW_API_URL = 'https://chat.example.com'
pnpm build
```

The loader copies **every** `data-` attribute onto the main file, so a new widget option never requires touching the loader. It once copied only `data-site-id`, and the new option silently never reached the widget — an automated test now guards this.

## Which model answers

Without a key the assistant answers from canned replies and everything else works: you can install the project, run it and click through the demo without creating a single account. `/api/health/ai` always reports who is answering right now.

Any service that speaks the OpenAI chat-completions dialect works, because that is the only thing the provider layer assumes. Switching services is configuration, not code:

```env
ECW_AI_PROVIDER="gemini"     # groq | gemini | custom | canned
ECW_AI_KEY="..."
ECW_AI_MODEL=""              # empty means the service default
```

| Service | Where to get a key |
|---|---|
| `groq` | <https://console.groq.com/keys> |
| `gemini` | <https://aistudio.google.com/apikey> |
| `custom` | any address in `ECW_AI_ENDPOINT`, including a model on your own machine |

A model running locally needs no account at all:

```env
ECW_AI_PROVIDER="custom"
ECW_AI_ENDPOINT="http://localhost:11434/v1/chat/completions"
ECW_AI_KEY="ollama"
ECW_AI_MODEL="qwen2.5:3b"
```

This flexibility is not decoration. While building the project, Groq's signup flow refused to let the author create an account at all; because the provider sits behind an interface, the fix was a two-line change of settings rather than a rewrite.

Daily spend is capped per site (`dailyTokenBudget`) and recorded in the database. When the cap is reached the assistant says so, and the message stays in the conversation for a human. Model keys and prompts are never sent to the browser.

Check that a key, an address and a model name actually work — one real request, a fraction of a cent:

```powershell
pnpm.cmd --filter @ecw/fixtures test:e2e ai
```

## Publishing

The package is published: **`ecw-widget@0.1.2`**. The live URL is verified by a test — the widget really does boot from the CDN, rather than merely building locally.

**npm requires two-factor authentication to publish.** Without it the registry answers `403` with a message about 2FA and no hint that the problem is the account rather than the package. There are two workable paths:

1. Enable 2FA and publish with a code from your authenticator app:

```powershell
npm.cmd publish --otp=123456
```

2. Or create a **granular access token**: permission `Read and write (publish and stage)`, the **bypass 2FA** checkbox ticked, and **All packages** selected. That last part matters: an unscoped package is not covered by a permission granted for the `@username` scope, and publishing fails even with an otherwise valid token.

```powershell
npm.cmd config set //registry.npmjs.org/:_authToken TOKEN
```

The token lands in `C:\Users\<you>\.npmrc` — **outside the repository**. Never add `--location=project`, which would write the secret into a file tracked by git.

Releasing the next version:

```powershell
cd packages\widget
npm.cmd version patch --no-git-tag-version
npm.cmd publish
```

Three details of this flow are the result of getting them wrong once:

- **`--no-git-tag-version`.** By default npm commits and tags the bump itself. On Windows it gives up on this repository — git cannot walk some deeply nested paths inside `node_modules` — and leaves the version changed but uncommitted, which then makes the next command fail with "Git working directory not clean". Bumping without git and committing by hand is boring and predictable.
- **The build runs by itself** (`prepublishOnly` in `package.json`). Before that was added, `npm publish` shipped whatever happened to be in `dist/`: version `0.1.1` went out containing a bundle that reported `0.1.0`. The CDN test checks that the version the widget reports matches the version in the URL, and it caught exactly this.
- **npm asks for a one-time code** from your authenticator app. Type it at the prompt, or pass `--otp=123456` — which is what a program running the command instead of a person needs.

A published version cannot be replaced. If a build turns out to be broken, publish the next patch and mark the bad one:

```powershell
npm.cmd deprecate ecw-widget@0.1.1 "Wrong build: the bundle reports version 0.1.0 in window.ECW.version. Use 0.1.2."
```

**The version in the URL is mandatory.** Without it, the next release would silently change the widget on every site it is already embedded in.

Check that customers will get a working URL:

```powershell
$env:ECW_CDN_URL = 'https://cdn.jsdelivr.net/npm/ecw-widget@0.1.2/dist/ecw-loader.iife.js'
pnpm.cmd --filter @ecw/fixtures test:e2e cdn
```

Without that variable the test is skipped: a check that fails before the first release only teaches people to ignore red.

## Known limitations

The project targets free hosting tiers and is therefore **designed to degrade**: if realtime fails, the widget falls back to polling; if the token budget runs out, it says so honestly and keeps working. No single layer failing should break the demo entirely.

Environment quirks found on the development machine are collected in [docs/PLAN.md](docs/PLAN.md#7-рабочая-среда-проверена-на-этой-машине).
