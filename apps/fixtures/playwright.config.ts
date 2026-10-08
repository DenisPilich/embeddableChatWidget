import { defineConfig, devices } from '@playwright/test';
import { apiBase, readSeed } from './e2e/api-helpers';

const BASE_URL = 'http://localhost:5173';

/**
 * Сервер приложения поднимаем только если база наполнена.
 *
 * Требовать живую базу от каждого, кто склонировал репозиторий, нельзя: проверки
 * виджета от неё не зависят. Нет данных наполнения — нет второго сервера, а
 * тесты API пропускаются.
 */
const seed = readSeed();

export default defineConfig({
  testDir: './e2e',

  // Тесты не зависят друг от друга, поэтому их можно гонять параллельно.
  fullyParallel: true,

  // В CI случайный повтор не должен маскировать настоящую ошибку, но и падать
  // из-за разовой заминки не хочется: один-два повтора — разумный компромисс.
  retries: process.env.CI ? 2 : 0,
  forbidOnly: Boolean(process.env.CI),

  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        // Работаем с установленным в системе Chrome вместо скачивания ещё
        // одной копии браузера: тесты должны запускаться на машине разработчика
        // без лишних сотен мегабайт.
        channel: 'chrome',
      },
    },
  ],

  // Playwright сам поднимает стенды перед тестами и гасит их после.
  //
  // Сборка виджета здесь намеренно НЕ выполняется, хотя логично было бы:
  // команда webServer целиком пропускается, когда Playwright переиспользует уже
  // запущенный сервер (reuseExistingServer). Тогда тесты молча проверяли бы
  // старый собранный файл — зелёный прогон на сломанном коде. Сборка живёт в
  // скрипте test:e2e, где её нельзя пропустить.
  webServer: [
    {
      command: 'pnpm --filter @ecw/fixtures dev',
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    ...(seed
      ? [
          {
            command: 'pnpm --filter @ecw/web dev',
            url: apiBase,
            reuseExistingServer: !process.env.CI,
            timeout: 180_000,
            // Ассистент в проверках отвечает заготовками, даже если у
            // разработчика задан ключ модели. Иначе набор стал бы платным,
            // медленным и зависимым от чужого сервиса: упавшая модель красила бы
            // тесты виджета, к которым она отношения не имеет.
            //
            // Настоящая модель проверяется отдельно — e2e/ai.spec.ts, и тоже
            // только когда ключ есть.
            env: { ECW_AI_PROVIDER: 'canned' },
          },
        ]
      : []),
  ],
});
