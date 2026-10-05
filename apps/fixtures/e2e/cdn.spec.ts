import { expect, test } from '@playwright/test';

/**
 * Дымовая проверка опубликованного пакета на живом CDN.
 *
 * Запускается только когда задан адрес загрузчика:
 *
 *   ECW_CDN_URL=https://cdn.jsdelivr.net/npm/ecw-widget@0.1.0/dist/ecw-loader.iife.js pnpm test:e2e cdn
 *
 * Без переменной тест пропускается. Это принципиально: тест, который падает до
 * первого релиза, приучает игнорировать красное, а это хуже отсутствия теста.
 */
const cdnUrl = process.env.ECW_CDN_URL;

test.describe('опубликованный пакет на CDN', () => {
  test.skip(!cdnUrl, 'нужен адрес загрузчика в переменной ECW_CDN_URL');

  test('виджет поднимается прямо со стороны CDN', async ({ page }) => {
    // Страница собирается на лету: проверяем именно то, что получит клиент, —
    // одну строку с чужого домена. У такой страницы непрозрачный источник, и
    // localStorage на ней недоступен: виджет обязан работать и так.
    await page.setContent(
      `<!doctype html><html lang="ru"><body><h1>Проверка CDN</h1>
       <script src="${cdnUrl}" data-site-id="cdn-check" async></script></body></html>`,
    );

    await expect(page.locator('.ecw-launcher')).toBeVisible();
    await page.locator('.ecw-launcher').click();
    await expect(page.locator('.ecw-panel')).toBeVisible();

    // Версия, которую виджет о себе сообщает, должна совпадать с той, что в
    // ссылке: иначе легко опубликовать одно, а подключить другое.
    const version = await page.evaluate(() => window.ECW?.version);
    expect(cdnUrl).toContain(version ?? '');
  });
});
