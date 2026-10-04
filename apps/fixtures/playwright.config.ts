import { defineConfig, devices } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';

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

  // Playwright сам поднимает стенд перед тестами и гасит его после.
  //
  // Сборка виджета здесь намеренно НЕ выполняется, хотя логично было бы:
  // команда webServer целиком пропускается, когда Playwright переиспользует уже
  // запущенный сервер (reuseExistingServer). Тогда тесты молча проверяли бы
  // старый собранный файл — зелёный прогон на сломанном коде. Сборка живёт в
  // скрипте test:e2e, где её нельзя пропустить.
  webServer: {
    command: 'pnpm --filter @ecw/fixtures dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
