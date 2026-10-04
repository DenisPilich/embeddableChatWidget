import { expect, test } from '@playwright/test';
import { HOST } from './helpers';

test.describe('одностраничное приложение', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/spa.html');
  });

  test('виджет переживает замену содержимого контейнера', async ({ page }) => {
    await expect(page.locator(HOST)).toHaveCount(1);

    await page.getByRole('button', { name: 'Меню' }).click();
    await expect(page.locator('#view h2')).toHaveText('Меню');

    await expect(page.locator(HOST)).toHaveCount(1);
    await expect(page.locator('.ecw-launcher')).toBeVisible();
  });

  test('повторные вызовы init при переходах не создают второй виджет', async ({ page }) => {
    // Каждый переход в этом стенде вызывает ECW.init() заново — так поступает
    // интегратор, поместивший инициализацию в перемонтируемый компонент.
    await page.getByRole('button', { name: 'Меню' }).click();
    await page.getByRole('button', { name: 'Контакты' }).click();
    await page.getByRole('button', { name: 'Главная' }).click();

    await expect(page.locator(HOST)).toHaveCount(1);
  });

  test('состояние окна не сбрасывается при переходах', async ({ page }) => {
    await page.locator('.ecw-launcher').click();
    await expect(page.locator('.ecw-panel')).toBeVisible();

    await page.getByRole('button', { name: 'Меню' }).click();

    await expect(page.locator('.ecw-panel')).toBeVisible();
    expect(await page.evaluate(() => window.ECW?.isOpen())).toBe(true);
  });

  test('переписка не теряется при переходах', async ({ page }) => {
    await page.locator('.ecw-launcher').click();

    const input = page.locator('.ecw-input');
    await input.fill('привет');
    await input.press('Enter');
    await expect(page.locator('.ecw-message--visitor')).toHaveCount(1);

    await page.getByRole('button', { name: 'Меню' }).click();

    await expect(page.locator('.ecw-message--visitor')).toHaveCount(1);
    await expect(page.locator('.ecw-message--visitor .ecw-message__bubble')).toHaveText('привет');
  });
});
