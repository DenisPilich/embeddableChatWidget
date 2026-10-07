import { expect, test } from '@playwright/test';
import { STUB_REPLY_PREFIX } from '../stub-api';
import { HOST } from './helpers';

test.describe('враждебная вёрстка', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/hostile.html');
  });

  test('виджет работает на странице с чужими !important', async ({ page }) => {
    await expect(page.locator('.ecw-launcher')).toBeVisible();

    await page.locator('.ecw-launcher').click();
    await expect(page.locator('.ecw-panel')).toBeVisible();

    const input = page.locator('.ecw-input');
    await input.fill('hello');
    await input.press('Enter');

    await expect(page.locator('.ecw-message--ai .ecw-message__bubble').last()).toContainText(
      STUB_REPLY_PREFIX,
    );
  });

  test('чужой !important не проникает внутрь виджета', async ({ page }) => {
    await page.locator('.ecw-launcher').click();

    const widget = await page.locator('.ecw-panel').evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        family: style.fontFamily,
        lineHeight: Number.parseFloat(style.lineHeight),
        letterSpacing: style.letterSpacing,
        textTransform: style.textTransform,
      };
    });

    expect(widget.family).not.toContain('Comic Sans');
    // На странице межстрочный интервал утроен: при 15px это дало бы 45px.
    expect(widget.lineHeight).toBeLessThan(30);
    expect(widget.letterSpacing).toBe('normal');
    expect(widget.textTransform).toBe('none');
  });

  test('чужой слой с большим z-index не перекрывает виджет', async ({ page }) => {
    const box = await page.locator('.ecw-launcher').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Берём точку в центре кнопки и смотрим, что находится в ней сверху.
    // Чужой слой имеет z-index 999999999, наш виджет — 2147483000.
    const topmost = await page.evaluate(
      ([x, y]) => {
        const element = document.elementFromPoint(x, y);
        if (!element) return null;
        return element.hasAttribute('data-ecw-host') ? 'ecw-host' : element.tagName.toLowerCase();
      },
      [box.x + box.width / 2, box.y + box.height / 2] as [number, number],
    );

    expect(topmost).toBe('ecw-host');

    // И функциональная проверка того же самого: Playwright отказывается кликать
    // по элементу, если поверх него лежит что-то чужое.
    await page.locator('.ecw-launcher').click();
    await expect(page.locator('.ecw-panel')).toBeVisible();
  });

  test('виджет не занимает места во враждебной вёрстке', async ({ page }) => {
    const hostBox = await page.locator(HOST).boundingBox();

    expect(hostBox?.width ?? -1).toBe(0);
    expect(hostBox?.height ?? -1).toBe(0);
  });
});
