import { expect, test } from '@playwright/test';
import { STUB_REPLY_PREFIX } from '../stub-api';
import { HOST } from './helpers';

test.describe('загрузчик и ленивая загрузка', () => {
  test('основной файл не загружается до готовности страницы', async ({ page }) => {
    // Отмечаем прямо в странице, был ли основной файл в DOM к моменту события
    // load. Так проверка становится однозначной: без неё пришлось бы ловить
    // момент гонкой между тестом и браузером.
    await page.addInitScript(() => {
      window.__ecwProbe = { bundleAtLoad: null };
      window.addEventListener('load', () => {
        window.__ecwProbe = {
          bundleAtLoad: document.querySelector('script[data-ecw-bundle]') !== null,
        };
      });
    });

    await page.goto('/');
    await expect(page.locator('.ecw-launcher')).toBeVisible();

    const probe = await page.evaluate(() => window.__ecwProbe);
    expect(probe?.bundleAtLoad).toBe(false);
  });

  test('основной файл подключается отдельным скриптом из той же папки', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.ecw-launcher')).toBeVisible();

    const injected = await page.evaluate(() => {
      const script = document.querySelector('script[data-ecw-bundle]');
      if (!(script instanceof HTMLScriptElement)) return null;
      return {
        src: script.getAttribute('src') ?? '',
        isAsync: script.async,
        siteId: script.getAttribute('data-site-id'),
        apiUrl: script.getAttribute('data-ecw-api'),
      };
    });

    expect(injected).not.toBeNull();
    // Адрес выводится из адреса загрузчика, поэтому файл лежит рядом с ним.
    expect(injected?.src).toContain('/ecw-widget.iife.js');
    expect(injected?.isAsync).toBe(true);
    // Переносятся ВСЕ параметры, а не только идентификатор сайта. Однажды
    // загрузчик уже знал лишь про data-site-id, и новый параметр молча не
    // доезжал до виджета — проверка сторожит именно этот случай.
    expect(injected?.siteId).toBe('stand-kofeynya');
    expect(injected?.apiUrl).toBe('http://localhost:5173');
  });

  test('повторное подключение загрузчика не создаёт второй виджет', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.ecw-launcher')).toBeVisible();

    // Клиент вставил сниппет второй раз — типичная история при сборке страницы
    // из кусков, где сниппет уже был в шаблоне.
    await page.evaluate(() => {
      const script = document.createElement('script');
      script.src = '/ecw-loader.iife.js';
      script.dataset.siteId = 'второй-сниппет';
      script.async = true;
      document.head.append(script);
    });
    await page.waitForTimeout(500);

    await expect(page.locator(HOST)).toHaveCount(1);
    expect(
      await page.evaluate(() => document.querySelectorAll('script[data-ecw-bundle]').length),
    ).toBe(1);
  });

  test('через загрузчик виджет работает так же, как при прямой вставке', async ({ page }) => {
    await page.goto('/');
    await page.locator('.ecw-launcher').click();
    await expect(page.locator('.ecw-panel')).toBeVisible();

    const input = page.locator('.ecw-input');
    await input.fill('привет');
    await input.press('Enter');

    await expect(page.locator('.ecw-message--ai .ecw-message__bubble').last()).toContainText(
      STUB_REPLY_PREFIX,
    );
  });
});
