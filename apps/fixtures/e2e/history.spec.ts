import { expect, test } from '@playwright/test';
import { STUB_REPLY_PREFIX } from '../stub-api';

test.describe('переписка переживает перезагрузку', () => {
  test('сообщения восстанавливаются после перезагрузки страницы', async ({ page }) => {
    await page.goto('/');
    await page.locator('.ecw-launcher').click();

    const input = page.locator('.ecw-input');
    await input.fill('what are your opening hours');
    await input.press('Enter');
    await expect(page.locator('.ecw-message--ai .ecw-message__bubble').last()).toContainText(
      STUB_REPLY_PREFIX,
    );

    await page.reload();

    await expect(page.locator('.ecw-message--visitor .ecw-message__bubble')).toHaveText(
      'what are your opening hours',
    );
    await expect(page.locator('.ecw-message--ai .ecw-message__bubble').last()).toContainText(
      STUB_REPLY_PREFIX,
    );
    // Приветствие не добавляется второй раз: в переписке оно ровно одно.
    // Сообщений ассистента при этом два — helloствие и ответ, — и это верно:
    // helloствие тоже часть переписки и сохраняется вместе с ней.
    await expect(
      page.locator('.ecw-message--ai', { hasText: 'Ask about our opening hours' }),
    ).toHaveCount(1);
  });

  test('в пустой переписке показывается helloствие', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('.ecw-message--ai')).toHaveCount(1);
    await expect(page.locator('.ecw-message--ai .ecw-message__bubble')).toContainText(
      'Ask about our opening hours',
    );
  });

  test('виджет работает, когда хранилище недоступно', async ({ page }) => {
    // Приватный режим и запрет сторонних данных: обращение к localStorage
    // может просто бросать исключение. Виджет обязан это пережить.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new Error('storage is not available');
        },
      });
    });

    await page.goto('/');
    await page.locator('.ecw-launcher').click();

    const input = page.locator('.ecw-input');
    await input.fill('hello');
    await input.press('Enter');

    await expect(page.locator('.ecw-message--visitor')).toHaveCount(1);
    await expect(page.locator('.ecw-message--ai .ecw-message__bubble').last()).toContainText(
      STUB_REPLY_PREFIX,
    );
  });

  test('повреждённые данные в хранилище не ломают виджет', async ({ page }) => {
    await page.goto('/');

    // Пишем мусор по тому же ключу, каким пользуется виджет. Так может
    // выглядеть старая версия виджета или чужой скрипт на той же странице.
    await page.evaluate(() => {
      localStorage.setItem(
        'ecw:stand-kofeynya:history:v1',
        '{"version":1,"messages":[{"id":42},{"id":"ok","body":"hello"}]}',
      );
    });
    await page.reload();

    // Мусор отброшен, показывается helloствие, виджет продолжает работать.
    await expect(page.locator('.ecw-message--ai')).toHaveCount(1);

    await page.locator('.ecw-launcher').click();
    const input = page.locator('.ecw-input');
    await input.fill('hello');
    await input.press('Enter');

    await expect(page.locator('.ecw-message--visitor')).toHaveCount(1);
  });
});
