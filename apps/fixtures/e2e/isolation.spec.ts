import { expect, test } from '@playwright/test';

test.describe('изоляция от страницы клиента', () => {
  test('шрифт и цвет страницы не проникают внутрь виджета', async ({ page }) => {
    await page.goto('/');

    // Страница стенда набрана шрифтом с засечками — это приманка.
    // Наследуемые свойства проходят сквозь границу Shadow DOM, поэтому без
    // сброса на :host виджет унаследовал бы и шрифт, и цвет.
    const pageStyles = await page.evaluate(() => {
      const style = getComputedStyle(document.body);
      return { font: style.fontFamily, color: style.color };
    });
    expect(pageStyles.font).toContain('Georgia');

    await page.locator('.ecw-launcher').click();
    const widgetStyles = await page.locator('.ecw-panel').evaluate((element) => {
      const style = getComputedStyle(element);
      return { font: style.fontFamily, color: style.color };
    });

    expect(widgetStyles.font).not.toContain('Georgia');
    expect(widgetStyles.color).not.toBe(pageStyles.color);
  });

  test('стили виджета не протекают на страницу', async ({ page }) => {
    await page.goto('/');

    // Кладём на страницу элемент с нашими классами. Стили из shadow root
    // до него дотянуться не должны — иначе виджет ломает вёрстку клиента.
    await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.id = 'probe';
      probe.className = 'ecw-message__bubble';
      probe.textContent = 'проба';
      document.body.append(probe);
    });

    const styles = await page.locator('#probe').evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        padding: style.padding,
        radius: style.borderRadius,
        background: style.backgroundColor,
      };
    });

    expect(styles.padding).toBe('0px');
    expect(styles.radius).toBe('0px');
    expect(styles.background).toBe('rgba(0, 0, 0, 0)');
  });

  test('вёрстка страницы не меняется от появления виджета', async ({ page }) => {
    await page.goto('/');

    // Виджет обязан быть нулевого размера и не занимать места в потоке.
    const hostBox = await page.locator('[data-ecw-host]').boundingBox();
    expect(hostBox?.width ?? -1).toBe(0);
    expect(hostBox?.height ?? -1).toBe(0);

    const pageHasNoHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(pageHasNoHorizontalScroll).toBe(true);
  });

  test('при трансформированном body виджет не уезжает из угла окна', async ({ page }) => {
    await page.goto('/transform-body.html');

    // transform на <body> создаёт новый containing block, и position: fixed
    // перестаёт привязываться к окну. Виджет обязан это заметить и перенести
    // host-элемент в <html>.
    const parentTag = await page
      .locator('[data-ecw-host]')
      .evaluate((element) => element.parentElement?.tagName ?? null);
    expect(parentTag).toBe('HTML');

    // И кнопка действительно остаётся на месте при прокрутке страницы.
    const before = await page.locator('.ecw-launcher').boundingBox();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const after = await page.locator('.ecw-launcher').boundingBox();

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    if (!before || !after) return;

    expect(Math.abs(after.y - before.y)).toBeLessThan(1);
  });
});
