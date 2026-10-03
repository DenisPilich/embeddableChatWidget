import type { InitOptions } from './types';

/**
 * Читает параметры из тега `<script>`, которым виджет подключён на странице:
 *
 * ```html
 * <script src="https://cdn.../ecw-widget.iife.js" data-site-id="site_123" async></script>
 * ```
 *
 * `document.currentScript` заполнен только во время выполнения самого скрипта —
 * позже он станет `null`, потому что на странице выполнится чужой код. Для
 * классического скрипта (без `type="module"`) это работает даже с `async`.
 *
 * Если параметров в теге нет, виджет не запускается сам: клиент вызовет
 * `window.ECW.init({ siteId })` вручную.
 */
export function readOptionsFromScript(): InitOptions | null {
  const script = document.currentScript;
  if (!(script instanceof HTMLScriptElement)) return null;

  const siteId = script.dataset.siteId?.trim();
  if (!siteId) return null;

  return { siteId };
}
