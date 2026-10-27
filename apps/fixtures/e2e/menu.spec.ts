import { expect, test } from '@playwright/test';

// Временный файл: ответ ассистента после выбора его пункта. Удаляется после.
const WEB = process.env.ECW_WEB_URL ?? 'http://localhost:3000';

test('ассистент отвечает после выбора своего пункта', async ({ page }) => {
  await page.goto(`${WEB}/demo`);
  await page.locator('.ecw-launcher').click();

  await expect(page.locator('.ecw-menu__item').first()).toBeVisible();
  await page.locator('.ecw-menu__item', { hasText: 'Ask my own question' }).click();

  // Выбор пункта обязан уйти на сервер: иначе модель не получает права отвечать.
  await expect(page.locator('.ecw-composer')).toBeVisible();

  await page.locator('.ecw-input').fill('Hi');
  await page.locator('.ecw-input').press('Enter');

  // Приветствие — одно сообщение ассистента; ответ — второе.
  await expect(page.locator('.ecw-message--ai')).toHaveCount(2, { timeout: 30_000 });
  await expect(page.locator('.ecw-header__status')).not.toContainText('Waiting for an operator');
});
