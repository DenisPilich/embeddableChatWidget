import { expect, test } from '@playwright/test';
import { STUB_REPLY_PREFIX } from '../stub-api';

test.describe('строгая Content Security Policy', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/csp.html');
  });

  test('политика на странице действительно строгая', async ({ page }) => {
    // Проверка самой проверки. Если политика вдруг перестанет применяться,
    // все остальные тесты в этом файле станут бессмысленными — и этот упадёт
    // первым, объяснив причину.
    const inlineStyleApplied = await page.evaluate(() => {
      const style = document.createElement('style');
      style.textContent = '.csp-probe { color: rgb(1, 2, 3); }';
      document.head.append(style);

      const probe = document.createElement('div');
      probe.className = 'csp-probe';
      document.body.append(probe);

      const applied = getComputedStyle(probe).color === 'rgb(1, 2, 3)';
      style.remove();
      probe.remove();
      return applied;
    });

    expect(inlineStyleApplied).toBe(false);
  });

  test('виджет загружается и работает при строгой политике', async ({ page }) => {
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

  test('оформление виджета применилось вопреки запрету встроенных стилей', async ({ page }) => {
    // Цвет читаем не сразу: вид окна приходит вместе с сессией, то есть через
    // сеть, и до этого кнопка носит цвет по умолчанию и плавно перекрашивается.
    // Ждём установившегося значения — оно и есть цвет владельца сайта.
    await expect
      .poll(() =>
        page
          .locator('.ecw-launcher')
          .evaluate((element) => getComputedStyle(element).backgroundColor),
      )
      .toBe('rgb(15, 118, 110)');

    const launcherColor = await page
      .locator('.ecw-launcher')
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(launcherColor).toBe('rgb(15, 118, 110)');

    await page.locator('.ecw-launcher').click();

    const panel = await page.locator('.ecw-panel').evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        radius: style.borderTopLeftRadius,
        shadow: style.boxShadow,
      };
    });

    // Если бы таблица стилей была заблокирована, здесь были бы значения по
    // умолчанию: прозрачный фон, нулевой радиус, отсутствие тени.
    expect(panel.background).toBe('rgb(255, 255, 255)');
    expect(panel.radius).toBe('16px');
    expect(panel.shadow).not.toBe('none');
  });
});
