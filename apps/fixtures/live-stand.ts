import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/**
 * Страница стенда, подключённая к настоящему серверу.
 *
 * Остальные стенды работают с двойником: он живёт внутри того же dev-сервера и
 * никуда не ходит. Это удобно для проверок виджета, но по такой странице нельзя
 * увидеть связку целиком — виджет, база, модель и панель оператора.
 *
 * Ключ сайта здесь подставить в файл нельзя: он случаен и создаётся при
 * наполнении базы. Поэтому страницу собираем на лету из данных наполнения —
 * тогда она не ломается после пересоздания базы.
 */
export function liveStand(): Plugin {
  const pageFile = fileURLToPath(new URL('./live.html', import.meta.url));
  const seedFile = fileURLToPath(new URL('../web/.seed-sites.json', import.meta.url));
  const apiUrl = process.env.ECW_API_URL ?? 'http://localhost:3000';

  return {
    name: 'ecw-live-stand',

    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== '/live.html') {
          next();
          return;
        }

        try {
          const seed = JSON.parse(readFileSync(seedFile, 'utf8')) as {
            sites?: { publicKey?: string }[];
          };

          const site = seed.sites?.[0];
          if (site?.publicKey === undefined) {
            throw new Error('в данных наполнения нет ни одного сайта');
          }

          const html = readFileSync(pageFile, 'utf8')
            .replaceAll('__SITE_ID__', site.publicKey)
            .replaceAll('__API_URL__', apiUrl);

          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.end(html);
        } catch (error) {
          // Пустая страница здесь хуже понятной ошибки: непонятно, то ли
          // страница не собралась, то ли базу не наполняли.
          response.statusCode = 500;
          response.setHeader('Content-Type', 'text/plain; charset=utf-8');
          response.end(
            `Страница не собрана: ${error instanceof Error ? error.message : String(error)}\n` +
              'Похоже, база не наполнена: pnpm --filter @ecw/web db:seed\n',
          );
        }
      });
    },
  };
}
