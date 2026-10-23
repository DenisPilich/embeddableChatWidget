import { expect, test } from '@playwright/test';
import { readSeed, requireSites } from './api-helpers';

/**
 * Проверка связки целиком: виджет на странице, настоящий сервер, база и панель.
 *
 * Остальные проверки виджета работают с двойником, а проверки API общаются с
 * сервером напрямую. Ни та, ни другая не отвечает на вопрос «а работает ли это
 * вместе». Здесь виджет берётся со страницы стенда, которая смотрит на настоящий
 * сервер.
 *
 * Сообщений не отправляем намеренно: живая модель тратит чужую квоту, а
 * бесплатный тариф — двадцать запросов в сутки. Связку видно и без ответа
 * модели.
 */
test.describe('Связка виджета с настоящим сервером', () => {
  test.skip(!readSeed(), 'нет данных наполнения: pnpm --filter @ecw/web db:seed');

  test('страница стенда собирается с ключом сайта', async ({ page }) => {
    const { first } = requireSites();
    await page.goto('/');

    // Ключ подставляется на лету из данных наполнения: без него страница
    // бесполезна, а понять это по пустому экрану нельзя.
    //
    // Берём первую метку: загрузчик создаёт вторую, для основного бандла, и
    // переносит в неё те же data-атрибуты.
    await expect(page.locator('script[data-ecw-api]').first()).toHaveAttribute(
      'data-site-id',
      first.publicKey,
    );
  });

  test('виджет на этой странице ходит в настоящий сервер, а не к двойнику', async ({ page }) => {
    await page.goto('/');
    await page.locator('.ecw-launcher').click();

    // Двойник отдаёт свой заголовок окна как настройку стенда. Настоящий сервер
    // отдаёт то, что записано в базе, — то есть умолчание. Различить их по адресу
    // нельзя: набор переиспользует запущенный сервер разработчика, и порт может
    // быть любым. А по заголовку — можно.
    await expect(page.locator('.ecw-header__title')).toBeVisible();
    await expect(page.locator('.ecw-header__title')).not.toHaveText('Stand support');
  });

  test('просьба о человеке доходит до базы через панель', async ({ page }) => {
    await page.goto('/');
    await page.locator('.ecw-launcher').click();

    // Ждём, пока виджет откроет сессию: до этого просьба уходит на сервер,
    // который ещё не ответил ни на один запрос, и первые попытки падают не по
    // вине посетителя. Виджет их повторяет, но проверке незачем измерять
    // терпение — она проверяет передачу человеку.
    await expect(page.locator('.ecw-menu__item').first()).toBeVisible();

    await page.locator('.ecw-link').click();

    // Подпись меняется только тогда, когда сервер действительно принял просьбу:
    // двойник здесь ни при чём. С недавних пор к ней добавился отсчёт ожидания —
    // поэтому проверяем начало подписи, а не всю строку.
    await expect(page.locator('.ecw-header__status')).toContainText('Waiting for an operator', {
      timeout: 20_000,
    });
  });

  test('чат открывается меню вопросов и отвечает без модели', async ({ page }) => {
    await page.goto('/');
    await page.locator('.ecw-launcher').click();

    // Первый экран — список вопросов, а не поле ввода: посетитель не должен
    // придумывать вопрос, чтобы начать.
    await expect(page.locator('.ecw-menu__item').first()).toBeVisible();
    await expect(page.locator('.ecw-composer')).toBeHidden();

    // Ответ лежит в базе, модель не участвует: проверка бесплатная и быстрая.
    await page.locator('.ecw-menu__item', { hasText: 'What are your opening hours?' }).click();

    await expect(page.locator('.ecw-message--ai .ecw-message__bubble').last()).toContainText(
      'Monday to Friday',
    );

    // Меню возвращается на место: посетитель часто спрашивает второе.
    await expect(page.locator('.ecw-menu__item').first()).toBeVisible();
  });
});
