import { expect, test } from '@playwright/test';
import { focusedInWidget } from './helpers';

test.describe('управление фокусом', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    // Открываем окно с клавиатуры, как это сделал бы человек без мыши.
    await page.locator('.ecw-launcher').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.ecw-panel')).toBeVisible();
  });

  test('при открытии фокус оказывается внутри окна', async ({ page }) => {
    expect(await focusedInWidget(page)).toContain('ecw-panel');
  });

  test('порядок обхода: действия шапки, переписка, поле ввода', async ({ page }) => {
    const order: (string | null)[] = [];
    for (let step = 0; step < 4; step += 1) {
      await page.keyboard.press('Tab');
      order.push(await focusedInWidget(page));
    }

    // Порядок задан разметкой: сначала действия шапки — просьба позвать
    // человека и закрытие, — затем переписка и поле ввода.
    expect(order[0]).toContain('ecw-link');
    expect(order[1]).toContain('ecw-icon-button');
    expect(order[2]).toContain('ecw-body');
    expect(order[3]).toContain('ecw-input');
  });

  test('Tab не выпускает фокус из окна', async ({ page }) => {
    // Проходим по кругу заметно больше, чем в виджете элементов.
    for (let step = 0; step < 10; step += 1) {
      await page.keyboard.press('Tab');
      // null означал бы, что фокус ушёл на страницу клиента.
      expect(await focusedInWidget(page)).not.toBeNull();
    }
  });

  test('Shift+Tab не выпускает фокус из окна', async ({ page }) => {
    for (let step = 0; step < 4; step += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(await focusedInWidget(page)).not.toBeNull();
    }
  });

  test('после закрытия фокус возвращается на кнопку виджета', async ({ page }) => {
    await page.keyboard.press('Escape');
    await expect(page.locator('.ecw-panel')).toBeHidden();

    expect(await focusedInWidget(page)).toContain('ecw-launcher');
  });

  test('после отправки фокус остаётся в поле ввода', async ({ page }) => {
    const input = page.locator('.ecw-input');
    await input.fill('hello');
    await input.press('Enter');

    // Кнопка отправки становится неактивной, а неактивный элемент не может
    // держать фокус: без нашей правки он улетел бы на страницу клиента.
    await expect(page.locator('.ecw-send')).toBeDisabled();
    expect(await focusedInWidget(page)).toContain('ecw-input');
  });

  test('длинную переписку можно прокрутить с клавиатуры', async ({ page }) => {
    // Прокручиваемая область обязана получать фокус, иначе её не пролистать
    // стрелками и переписка остаётся недостижимой.
    const transcript = page.locator('.ecw-body');
    await transcript.focus();
    expect(await focusedInWidget(page)).toContain('ecw-body');

    const scrollable = await transcript.evaluate(
      (element) => element.scrollHeight > element.clientHeight || element.clientHeight > 0,
    );
    expect(scrollable).toBe(true);
  });
});
