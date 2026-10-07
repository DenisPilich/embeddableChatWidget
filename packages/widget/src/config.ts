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

  const apiUrl = script.dataset.ecwApi?.trim();
  return apiUrl ? { siteId, apiUrl } : { siteId };
}

/**
 * Адрес API: заданный на странице или зашитый при сборке.
 *
 * Хвостовые косые черты убираем здесь, а не в каждом запросе: иначе адрес вида
 * `https://api.example.com/` дал бы `//api/v1/init`, а на такое часть серверов
 * отвечает ошибкой перенаправления.
 *
 * Аргумент принимается как `unknown`, потому что виджет вызывают и из обычного
 * JavaScript, где типов нет: строка там не гарантирована, а падать на этом
 * виджет не имеет права.
 */
export function resolveApiUrl(value: unknown): string {
  const fromPage = typeof value === 'string' ? value.trim() : '';
  return (fromPage || __ECW_API_URL__).replace(/\/+$/, '');
}
