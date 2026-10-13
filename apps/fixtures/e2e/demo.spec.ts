import { expect, test } from '@playwright/test';
import { readSeed } from './api-helpers';

/**
 * Демонстрационная страница внутри приложения.
 *
 * Это тот путь, по которому пойдёт посетитель на развёрнутом варианте: одна
 * ссылка, и на одном домене всё — страница клиента, виджет, API и панель.
 * Проверка сторожит главное свойство этого устройства: адрес API относительный,
 * поэтому страница работает и на localhost, и на боевом домене без правок.
 */

const WEB = process.env.ECW_WEB_URL ?? 'http://localhost:3000';

test.describe('Демонстрационная страница', () => {
  test.skip(!readSeed(), 'нет данных наполнения: pnpm --filter @ecw/web db:seed');

  test('виджет подключается к тому же домену, что и страница', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/')) requests.push(request.url());
    });

    await page.goto(`${WEB}/demo`);
    await page.locator('.ecw-launcher').click();
    await expect(page.locator('.ecw-header__title')).toBeVisible();

    expect(requests.length).toBeGreaterThan(0);

    // Тот же домен, а не localhost:3000 строкой в разметке. Иначе на развёрнутом
    // варианте виджет стучался бы в никуда, и понять это по странице было бы
    // нельзя.
    const origin = new URL(page.url()).origin;
    for (const url of requests) expect(new URL(url).origin).toBe(origin);
  });

  test('на странице есть ключ сайта из базы', async ({ page }) => {
    await page.goto(`${WEB}/demo`);

    // Ключ случайный и живёт в базе: вписанный в разметку, он сломался бы после
    // пересоздания базы.
    //
    // Берём первую метку: загрузчик создаёт вторую, для основного бандла, и
    // переносит в неё те же data-атрибуты. Без этого проверка ловила бы то одну
    // метку, то две — и падала бы через раз.
    await expect(page.locator('script[data-ecw-api]').first()).toHaveAttribute(
      'data-site-id',
      /^pub_/,
    );
  });
});
