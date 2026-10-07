import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { STUB_REPLY_PREFIX } from '../stub-api';

/** Отправляет сообщение и сразу закрывает окно, не дожидаясь ответа. */
async function sendAndClose(page: Page): Promise<void> {
  await page.locator('.ecw-launcher').click();

  const input = page.locator('.ecw-input');
  await input.fill('привет');
  await input.press('Enter');

  await page.keyboard.press('Escape');
  await expect(page.locator('.ecw-panel')).toBeHidden();
}

test.describe('счётчик непрочитанных', () => {
  test('ответ, пришедший в закрытое окно, показывается на кнопке', async ({ page }) => {
    await page.goto('/');
    await sendAndClose(page);

    const badge = page.locator('.ecw-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('1');

    // Число озвучивается словами: цифра в кружке для программы чтения с экрана
    // не значит ничего.
    await expect(page.locator('.ecw-launcher')).toHaveAttribute(
      'aria-label',
      'Открыть чат, новых сообщений: 1',
    );
  });

  test('открытие окна сбрасывает счётчик', async ({ page }) => {
    await page.goto('/');
    await sendAndClose(page);

    const badge = page.locator('.ecw-badge');
    await expect(badge).toBeVisible();

    await page.locator('.ecw-launcher').click();

    await expect(badge).toBeHidden();
    await expect(page.locator('.ecw-launcher')).toHaveAttribute('aria-label', 'Закрыть чат');
  });

  test('ответ при открытом окне счётчик не увеличивает', async ({ page }) => {
    await page.goto('/');
    await page.locator('.ecw-launcher').click();

    const input = page.locator('.ecw-input');
    await input.fill('привет');
    await input.press('Enter');
    await expect(page.locator('.ecw-message--ai .ecw-message__bubble').last()).toContainText(
      STUB_REPLY_PREFIX,
    );

    await expect(page.locator('.ecw-badge')).toBeHidden();
  });
});
