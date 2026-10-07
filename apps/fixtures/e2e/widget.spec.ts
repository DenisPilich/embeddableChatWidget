import { expect, test } from '@playwright/test';
import { STUB_REPLY_PREFIX } from '../stub-api';
import { HOST } from './helpers';

test.describe('виджет на странице клиента', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('создаётся ровно один виджет, версия доступна со страницы', async ({ page }) => {
    await expect(page.locator(HOST)).toHaveCount(1);

    const version = await page.evaluate(() => window.ECW?.version);
    expect(version).toBe('0.1.0');
  });

  test('повторная инициализация не создаёт второй виджет', async ({ page }) => {
    await page.evaluate(() => window.ECW?.init({ siteId: 'второй-сайт' }));

    await expect(page.locator(HOST)).toHaveCount(1);
  });

  test('окно открывается кнопкой и закрывается повторным нажатием', async ({ page }) => {
    const panel = page.locator('.ecw-panel');
    await expect(panel).toBeHidden();

    await page.locator('.ecw-launcher').click();
    await expect(panel).toBeVisible();
    await expect(page.locator('.ecw-launcher')).toHaveAttribute('aria-expanded', 'true');

    await page.locator('.ecw-launcher').click();
    await expect(panel).toBeHidden();
    await expect(page.locator('.ecw-launcher')).toHaveAttribute('aria-expanded', 'false');
  });

  test('окно закрывается клавишей Esc', async ({ page }) => {
    await page.locator('.ecw-launcher').click();
    await expect(page.locator('.ecw-panel')).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.locator('.ecw-panel')).toBeHidden();
  });

  test('сообщение отправляется и на него приходит ответ', async ({ page }) => {
    await page.locator('.ecw-launcher').click();

    const input = page.locator('.ecw-input');
    await input.fill('во сколько вы работаете');
    await input.press('Enter');

    // Сообщение появляется сразу, до ответа: интерфейс оптимистичный.
    await expect(page.locator('.ecw-message--visitor .ecw-message__bubble')).toHaveText(
      'во сколько вы работаете',
    );

    // Сначала индикатор набора, затем ответ. Отвечает не виджет, а сервер: здесь
    // стоит его двойник, и по пометке в ответе видно, что круг замкнулся —
    // сообщение ушло, дошло и вернулось в общий список диалога.
    await expect(page.locator('.ecw-message--typing')).toBeVisible();
    await expect(page.locator('.ecw-message--ai .ecw-message__bubble').last()).toContainText(
      STUB_REPLY_PREFIX,
    );
  });

  test('разметка в сообщении не исполняется', async ({ page }) => {
    await page.locator('.ecw-launcher').click();

    // Если бы текст посетителя попадал в DOM через innerHTML, этот обработчик
    // выполнился бы. Проверяем, что он остался обычным текстом.
    const payload = '<img src=x onerror="window.__xss = true">';
    const input = page.locator('.ecw-input');
    await input.fill(payload);
    await input.press('Enter');

    const bubble = page.locator('.ecw-message--visitor .ecw-message__bubble');
    await expect(bubble).toHaveText(payload);
    await expect(bubble.locator('img')).toHaveCount(0);

    expect(await page.evaluate(() => '__xss' in window)).toBe(false);
  });

  test('пустое сообщение отправить нельзя', async ({ page }) => {
    await page.locator('.ecw-launcher').click();
    const send = page.locator('.ecw-send');
    const input = page.locator('.ecw-input');

    await expect(send).toBeDisabled();

    await input.fill('   ');
    await expect(send).toBeDisabled();

    await input.fill('привет');
    await expect(send).toBeEnabled();
  });

  test('Shift+Enter переносит строку, а не отправляет', async ({ page }) => {
    await page.locator('.ecw-launcher').click();

    const input = page.locator('.ecw-input');
    await input.fill('первая строка');
    await input.press('Shift+Enter');
    await input.type('вторая строка');

    await expect(input).toHaveValue('первая строка\nвторая строка');
    await expect(page.locator('.ecw-message--visitor')).toHaveCount(0);
  });
});
