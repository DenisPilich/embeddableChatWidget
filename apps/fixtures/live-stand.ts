import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/**
 * Ключ сайта на главной странице демонстрации.
 *
 * Остальные стенды работают с двойником: он живёт внутри dev-сервера и никуда не
 * ходит. Это удобно для проверок виджета, но по такой странице нельзя увидеть
 * связку целиком — виджет, база, модель и панель оператора. Поэтому главная
 * страница подключена к настоящему серверу.
 *
 * Ключ сайта подставить в файл нельзя: он случаен и создаётся при наполнении
 * базы. Поэтому подставляем его на лету — и читаем файл наполнения при каждом
 * запросе, а не при запуске сервера: пересоздание базы не требует перезапуска.
 */
export function liveStand(): Plugin {
  const seedFile = fileURLToPath(new URL('../web/.seed-sites.json', import.meta.url));
  const apiUrl = process.env.ECW_API_URL ?? 'http://localhost:3000';

  /**
   * Что показать вместо страницы, если базу не наполняли.
   *
   * Пустой экран с неработающим виджетом — худший вариант: непонятно ни что
   * случилось, ни что делать. Поэтому говорим прямо и даём команду.
   */
  const notSeeded = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>The database is not seeded</title>
    <style>
      body { margin: 0; padding: 3rem 1.5rem; font: 16px/1.6 system-ui, sans-serif; color: #0f172a; background: #f8fafc; }
      main { max-width: 36rem; margin: 0 auto; padding: 28px; border-radius: 16px; background: #fff; box-shadow: 0 8px 24px rgba(15,23,42,.08); }
      code { padding: 2px 6px; border-radius: 6px; background: #f1f5f9; }
    </style>
  </head>
  <body>
    <main>
      <h1>The database is not seeded</h1>
      <p>
        This page connects the widget to the real backend, and the backend needs a site to talk
        about. Its key is created by the seed, so there is nothing to show yet.
      </p>
      <p>Run this, then reload:</p>
      <p><code>pnpm --filter @ecw/web db:seed</code></p>
      <p>
        The test stands (<a href="/stub.html">/stub.html</a> and the rest) work without a database —
        they answer from a double inside the dev server.
      </p>
    </main>
  </body>
</html>
`;

  function readPublicKey(): string | null {
    try {
      const seed = JSON.parse(readFileSync(seedFile, 'utf8')) as {
        sites?: { publicKey?: string }[];
      };

      return seed.sites?.[0]?.publicKey ?? null;
    } catch {
      return null;
    }
  }

  return {
    name: 'ecw-live-stand',

    transformIndexHtml(html) {
      // Подставляем только там, где есть метки: остальные страницы стендов
      // подключаются к двойнику и в подстановке не нуждаются.
      if (!html.includes('__SITE_ID__')) return html;

      const publicKey = readPublicKey();
      if (publicKey === null) return notSeeded;

      return html.replaceAll('__SITE_ID__', publicKey).replaceAll('__API_URL__', apiUrl);
    },
  };
}
