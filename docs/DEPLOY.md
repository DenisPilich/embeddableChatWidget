# Deploying the demo

The goal: one public URL where the whole thing works — the customer page, the widget, the API, the database and the operator dashboard. Everything is served by the Next.js application, so there is exactly one deployment and one address.

The widget is published to npm as well (`ecw-widget`), so a real customer can embed it from a CDN. That path is proven by the test in `apps/fixtures/e2e/cdn.spec.ts`; the demo page in this application serves the widget from its own `/ecw/` folder instead, so the deployment always shows the code in the repository rather than the last published release.

## What is already in place

- The demo page lives in the application: `apps/web/app/demo/page.tsx`, on `/demo`.
- Its build copies the freshly built widget into `public/ecw` (`apps/web/scripts/copy-widget.mjs`), and the widget is loaded with `data-ecw-api="/"` — a relative address, so the same page works on `localhost` and on a public domain without edits.
- Migrations are applied to the database used for development, so a production build has a schema to talk to.

## What only you can do

### 1. Push the repository

The local branch is ahead of GitHub, so the deployment would otherwise build old code.

```powershell
git push
```

### 2. Create a Vercel account and import the repository

Sign up at <https://vercel.com> (signing in with GitHub is the shortest path), then **Add New → Project** and pick `DenisPilich/embeddableChatWidget`.

Settings on the import screen:

| Setting | Value |
|---|---|
| Framework preset | Next.js (detected automatically) |
| Root Directory | `apps/web` |
| Build Command | leave the default — it runs `build` from `apps/web/package.json` |
| Install Command | leave the default |

If Vercel asks about installing dependencies for the whole monorepo, allow it: the application uses a shared workspace package, and pnpm resolves it from the repository root.

### 3. Add environment variables

In **Settings → Environment Variables**, copy the values from your local `apps/web/.env`:

| Name | What it is |
|---|---|
| `DATABASE_URL` | Neon pooled connection string |
| `DIRECT_URL` | Neon direct connection string (the Prisma CLI validates it on every run) |
| `ECW_TOKEN_SECRET` | the secret that signs widget tokens and operator sessions |
| `ECW_AI_PROVIDER` | `gemini` |
| `ECW_AI_KEY` | the model key |
| `ECW_AI_MODEL` | the model name |

Use a **fresh** `ECW_TOKEN_SECRET` for the deployment rather than the development one — it signs real sessions there:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

### 4. Deploy, then allow the new address

After the first deploy Vercel gives you an address like `https://embeddable-chat-widget.vercel.app`.

The widget will not work on it yet, and the reason is not obvious: the backend accepts requests **only from the addresses listed for the site**. The demo page and the API share a domain, so that domain has to be in the list.

Add it yourself in the dashboard, which is a good way to see the settings page working:

1. Open `https://<your-address>/dashboard` and sign in as `demo@example.com` / `demo-operator-2026`.
2. Open **Sites → Stand "Little Cloud Coffee"**.
3. Add the address to *Allowed origins*, on its own line, and save.
4. Reload `/demo` — the widget should connect.

## What to check afterwards

| Address | What should happen |
|---|---|
| `/demo` | The coffee shop page with the widget; a question is answered by the real model |
| `/dashboard` | Sign-in, the conversation queue, replies, site settings |
| `/api/health` | `{"status":"ok"}` — the application answers at all |
| `/api/health/db` | The database is reachable |
| `/api/health/ai` | Which model is configured; `?check=1` makes one real request |

Then the full loop: ask something on `/demo`, press **Talk to a human**, answer from the dashboard, and watch the answer appear in the widget.

## Clean the demo before showing it

The queue shows every conversation of the site, including the ones left by test runs. Before showing the project to anyone:

```powershell
pnpm db:reset-demo
```

This deletes conversations and visitors and keeps sites, users and assistant settings. It uses the `DATABASE_URL` from `apps/web/.env` — the same database the deployment uses, which is why the deployed queue becomes empty too.

## If something goes wrong

- **The build fails on a missing `DATABASE_URL`.** The Prisma CLI validates its variables even for `prisma generate`. Add the variables from step 3 and redeploy; the build does not need a reachable database, only the names.
- **The widget shows nothing on `/demo`.** Open the browser console: a refused request means the address is not in *Allowed origins* (step 4). That refusal is deliberate — it is what stops a copied site key from spending someone else's budget.
- **It used to work and then stopped after `pnpm db:seed`.** The seed merges local origins into the site instead of replacing them, but a site seeded *before* that change may have lost the deployed address. Check it in *Sites* and add the address back. The database is one for both local and deployed runs, so anything that rewrites site settings reaches production too.
- **The widget says "not sent" in red on a live page.** That is the visitor-side wording for any failed request; the cause is on the server. Walk the same path by hand: `/api/health`, then `/api/v1/init` with the page's `Origin` header — a 403 there means the origin is not allowed, and the message never had a chance.
- **Every request answers 401, including `/api/health`.** That is not the application: it is Vercel's Deployment Protection, which closes preview deployments by default. The production alias is public, the per-deployment URLs (`…-c1wvxwvpm-….vercel.app`) are not. Two ways out: use the alias, or open *Settings → Deployment Protection* and let previews through — safe here, because the dashboard has its own sign-in and the widget's origin check is unchanged. Whichever you pick, put the **alias** in your portfolio and never a preview URL: previews change with every push.
- **The queue is empty after asking a question on `/demo`.** Check that the question went to `/api/v1/...` on the same domain. If it went to `localhost:5173`, the page was served by the Vite stand rather than the application.
- **The assistant says it is unavailable.** The model service refused: wrong key, or an exhausted free quota (Gemini allows about twenty requests a day). `/api/health/ai?check=1` answers which of the two it is.
