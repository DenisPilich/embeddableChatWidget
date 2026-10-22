# ecw-widget

An embeddable chat widget in one `<script>` tag. The model answers by default, a human operator takes over when the visitor asks for one, answers stream in as they are written, and none of it disturbs the page it lands on.

![The chat widget open on a demo page: a question and the assistant's answer](https://raw.githubusercontent.com/DenisPilich/embeddableChatWidget/main/docs/widget-panel.png)

- **11.04 kB gzipped**, no framework, no stylesheet leaking into the page.
- Opens on a **guided menu** the site owner writes: instant answers, no model, no quota.
- Isolated in a **Shadow DOM**: page styles cannot reach in, widget styles cannot leak out.
- Works on pages with a strict `Content-Security-Policy`.
- Answers arrive over **Server-Sent Events**; the conversation survives a reload.

## Embed

```html
<script
  src="https://cdn.jsdelivr.net/npm/ecw-widget@0.3.0/dist/ecw-loader.iife.js"
  data-site-id="pub_your_site_key"
  data-ecw-api="https://your-app.example.com"
  async
></script>
```

| Attribute | Required | What it does |
|---|---|---|
| `data-site-id` | yes | The site key, issued when the site is created in the dashboard. It identifies which site the conversation belongs to. |
| `data-ecw-api` | no | Where the widget's API lives. Defaults to the demo server baked into the build — set it to your own installation. `data-ecw-api="/"` means "same origin as this page". |

**Pin the version.** Without it, the next publish silently changes the widget on every site that already embedded it. A new version means a new URL.

## What happens on the page

1. The tag loads a small **loader**, not the widget itself.
2. The loader waits for the page's `load` event — a widget must not appear in the customer's page metrics, since those decide search ranking — then fetches the real bundle and mounts it. A safety timeout covers pages that never finish loading.
3. The bubble appears in the corner. Nothing else changes: the host element has zero size and takes no part in the layout.

| File | Size (gzipped) | When it loads |
|---|---|---|
| `dist/ecw-loader.iife.js` | 678 B | immediately — this is the tag on the page |
| `dist/ecw-widget.iife.js` | 11.04 kB | after `load`, while the browser is idle |

The loader derives the bundle's address from its own `src`, so the two files can never get out of step — which is also why the version in the URL covers both.

## The visitor sees a menu first

There is no input field until the visitor picks something. Opening hours, delivery, prices — the
owner writes these once and the answers arrive instantly. A visitor who has to invent a question
either invents a bad one or leaves.

Each item is one of four things:

| Action | What happens |
|---|---|
| **Answer** | The question and the written answer appear in the conversation. |
| **Submenu** | Opens a nested list — because five questions read as a menu and twenty read as a wall. |
| **Operator** | Calls a human and starts the countdown. |
| **AI** | Reveals the input field and lets the model answer a free-form question. |

The **AI item is hidden unless the assistant is switched on** for the site, and the assistant is off
by default: the menu works without it, and the model is the last item rather than the only way in.

### Waiting for a human

Picking the operator item starts a countdown in the header — `Waiting for an operator · 4:12`. The
deadline comes from the server, so closing the tab and coming back resumes the same wait instead of
starting over. When it runs out the widget stops pretending and offers a phone number:

> Sorry for the wait. Leave your number and we will call you back.

The field is prefilled with `+373` (configurable on the server side) and the visitor is not forced to
use it. A number that is left arrives in the operator's queue with the conversation.

## What the visitor gets

- **Streaming answers.** In the free-form item, text appears as the model writes it, with a typing indicator in between.
- **A conversation that survives.** Messages live in the page's `localStorage` and are replayed from the server on reload — a refreshed tab does not lose the thread, and messages that arrived while the tab was closed are caught up.
- **A human, on request.** The operator item flags the conversation; the assistant goes quiet so the visitor never reads two different voices answering in turn. The operator's reply arrives the same way the model's do.
- **Honest failures.** A message that did not go through says so and can be retried; the same message is never stored twice, even if the visitor retries it.

## The other side

Operators answer from a dashboard: a queue ordered by longest wait, the waiting count in the tab title, search across the conversation text, bulk closing, per-site prompts and appearance, and workspaces that keep one customer's conversations invisible to another.

![The operator dashboard: a queue with two conversations waiting for a human](https://raw.githubusercontent.com/DenisPilich/embeddableChatWidget/main/docs/dashboard.png)

## Isolation from the host page

- Markup and styles live in a **Shadow DOM**. Tested against a page that sets `!important` on every property.
- Inherited properties are reset on an inner wrapper, so page selectors cannot reach inside.
- Styles are injected through `adoptedStyleSheets` built in the script, so they survive `style-src 'self'` without `unsafe-inline`.
- The host element is zero-sized and does not affect layout. If `<body>` carries a `transform`, it is moved to `<html>` — otherwise `position: fixed` would stop tracking the viewport.
- Every entry point is wrapped: an exception inside the widget must never break the customer's page.

## Page API

```js
window.ECW.version;            // package version
window.ECW.init({ siteId });   // when the parameters are not in the tag
window.ECW.open();
window.ECW.close();
window.ECW.toggle();
window.ECW.isOpen();

window.ECW_DEBUG = true;       // debug messages in the console
```

Calling `init` twice is safe — a second widget will not appear. Integrators keep putting initialisation into components that remount, and a duplicated bubble is a bug report waiting to happen.

## Settings that arrive with the session

Colour, window title, greeting, the menu itself, whether the assistant answers free-form questions,
and how long to wait for a human — all of it is set **per site on the server**, not in the tag. The
widget asks for a session and receives all of it, so changing any of these does not require editing
the customer's page or republishing the package.

## Self-hosting

Copy both files from `dist/` onto your own server and point the tag at the loader there. The two files must stay next to each other — the loader resolves the bundle's address relative to its own. Build with `ECW_API_URL=https://your-app.example.com` to bake in a different default API address.

## Browser support

Modern evergreen browsers: the widget needs Shadow DOM and constructable stylesheets — Chrome/Edge 73+, Firefox 101+, Safari 16.4+.

## Development

This package is one part of a larger project: the API, the operator dashboard and the demo page live in the same repository. The architecture journal, the plan and the reasoning behind each decision are there too:

**<https://github.com/DenisPilich/embeddableChatWidget>**

The widget itself is plain TypeScript with no runtime dependencies, built with Vite in library mode. `pnpm --filter ecw-widget build` produces both files; the size budget is enforced by the repository's `pnpm verify`, which fails if the bundle grows past 15 kB gzipped.

## License

MIT
