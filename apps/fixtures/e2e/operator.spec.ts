import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import {
  apiBase,
  readSeed,
  requireSites,
  type InitResponseBody,
  type MessagesResponseBody,
  type SeededSite,
} from './api-helpers';

/**
 * Проверки панели оператора.
 *
 * Ведут себя как человек: входят через форму, читают очередь, отвечают. Поэтому
 * проверяется не только серверная часть, но и то, что панель пригодна для
 * работы — а это и есть её смысл.
 *
 * Пропускаются, если база не наполнена: без неё проверять нечего.
 */

const WEB = process.env.ECW_WEB_URL ?? 'http://localhost:3000';

/**
 * Демонстрационный оператор из наполнения базы.
 *
 * Пароль лежит открытым текстом в сиде и здесь: это данные разработки, а не
 * секрет. В рабочем развёртывании оператора заводит владелец.
 */
const OPERATOR = { email: 'demo@example.com', password: 'demo-operator-2026' };

test.describe('Панель оператора', () => {
  test.skip(!readSeed(), 'нет данных наполнения: pnpm --filter @ecw/web db:seed');

  test('без входа панель недоступна', async ({ page }) => {
    await page.goto(`${WEB}/dashboard`);

    // Не «ошибка», а именно перенаправление на вход: человек должен попасть туда,
    // где может что-то сделать.
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('вход с неверным паролем отклоняется одинаково для любой причины', async ({ page }) => {
    await page.goto(`${WEB}/login`);
    await page.getByLabel('Email').fill(OPERATOR.email);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // По классу, а не по роли: в режиме разработки Next добавляет на страницу
    // свои элементы с ролью alert, и поиск по роли находит два.
    await expect(page.locator('.login__error')).toContainText('Wrong email or password');
  });

  test('оператор отвечает в диалоге, который ждёт человека', async ({ page, request }) => {
    const { first } = requireSites();
    const session = await startSession(request, first);

    // Готовим настоящий сценарий: посетитель попросил человека. Выдуманные
    // данные здесь не годятся — проверяем то, ради чего панель существует.
    const handover = await request.post(`${apiBase}/api/v1/handover`, {
      headers: authHeaders(session),
    });
    expect(handover.status()).toBe(200);

    await signIn(page);

    // Очередь показывает ожидающих.
    await expect(page.locator('.queue__row--waiting').first()).toBeVisible();

    // Открываем именно свой диалог: очередь может содержать диалоги прошлых
    // запусков, и привязываться к её порядку значило бы проверять не то.
    await page.goto(`${WEB}/dashboard/conversations/${session.conversationId}`);
    await expect(page.locator('.conversation__note')).toContainText('Waiting for a human');

    // Отправляем сочетанием клавиш, а не кнопкой: ответов в день десятки, и
    // сочетание сделано именно ради них.
    await page.getByLabel('Reply as operator').fill('A human is here now.');
    await page.getByLabel('Reply as operator').press('Control+Enter');

    // Ответ доходит до посетителя тем же путём, которым его забирает виджет.
    await expect
      .poll(async () => {
        const messages = await listMessages(request, session);
        return messages.some(
          (message) => message.authorKind === 'agent' && message.body === 'A human is here now.',
        );
      })
      .toBe(true);
  });

  test('владелец сохраняет настройки сайта, а чужой сайт ему недоступен', async ({
    page,
    request,
  }) => {
    const { first } = requireSites();
    await signIn(page);

    await page.goto(`${WEB}/dashboard/sites/${first.id}`);
    await page.getByLabel('Window title').fill('Little Cloud');
    await page.getByRole('button', { name: 'Save settings' }).click();

    await expect(page.locator('.conversation__note')).toContainText('Saved');

    // Значение доехало до виджета: вид приходит вместе с сессией.
    const response = await request.post(`${apiBase}/api/v1/init`, {
      headers: { Origin: first.allowedOrigins[0] ?? '', 'Content-Type': 'application/json' },
      data: { siteId: first.publicKey },
    });
    const body = (await response.json()) as { appearance: { title: string | null } };
    expect(body.appearance.title).toBe('Little Cloud');

    // И чужой сайт недоступен — так же, как чужой диалог.
    const foreign = readSeed()?.sites.find((site) => site.id === 'site_second_owner');
    if (foreign !== undefined) {
      const denied = await page.goto(`${WEB}/dashboard/sites/${foreign.id}`);
      expect(denied?.status()).toBe(404);
    }
  });

  test('оператор не видит диалог чужого пространства', async ({ page, request }) => {
    const foreign = readSeed()?.sites.find((site) => site.id === 'site_second_owner');
    test.skip(foreign === undefined, 'в наполнении нет второго владельца');
    // После пропуска значение точно есть, но компилятор об этом не знает.
    if (foreign === undefined) return;

    // Заводим разговор на сайте другого владельца.
    const session = await startSession(request, foreign);
    await signIn(page);

    const response = await page.goto(`${WEB}/dashboard/conversations/${session.conversationId}`);

    // Именно «нет страницы», а не «нет доступа»: само существование чужого
    // диалога — не наше дело, и подтверждать его мы не станем.
    expect(response?.status()).toBe(404);
  });
  test('очередь обновляется сама, без перезагрузки', async ({ page, request }) => {
    await signIn(page);

    // Разговор заводит посетитель, а не оператор: панель об этом ещё не знает.
    const { first } = requireSites();
    const session = await startSession(request, first);
    await request.post(`${apiBase}/api/v1/handover`, { headers: authHeaders(session) });

    // Смотрим вкладку «все», а не «ждут»: во вкладке ожидающих список ограничен
    // полусотней и отсортирован самыми долго ждущими вперёд, поэтому свежий
    // разговор может оказаться за пределами списка. Здесь он самый свежий и
    // потому первый — проверка не зависит от накопленных данных.
    await page.goto(`${WEB}/dashboard?filter=all`);

    // Ждём появления ИМЕННО своего разговора, а не роста общего числа: проверки
    // идут параллельно, соседние закрывают и возвращают разговоры, и общее число
    // ожидающих от этого ходит вверх и вниз. Своя строка — не ходит.
    await expect
      .poll(
        async () =>
          page.locator(`a[href="/dashboard/conversations/${session.conversationId}"]`).count(),
        { timeout: 30_000 },
      )
      .toBe(1);

    // Число ожидающих видно и в заголовке вкладки: окно оператора часто не в
    // фокусе, а почты и звука у нас нет.
    //
    // Сверяем заголовок с числом на вкладке, а не с ожидаемым значением: общее
    // число ожидающих меняют соседние проверки, и жёсткое «(1)» ломалось бы при
    // каждом параллельном закрытии разговора.
    await expect
      .poll(
        async () => {
          const onTab =
            (
              await page
                .locator('.tab', { hasText: 'Waiting' })
                .locator('.tab__count')
                .textContent()
            )?.trim() ?? '0';
          const title = await page.title();
          return onTab === '0' ? title === 'Conversations' : title.startsWith(`(${onTab})`);
        },
        { timeout: 20_000 },
      )
      .toBe(true);
  });

  test('на узком экране панелью можно пользоваться', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);

    await expect(page.locator('.page__title')).toBeVisible();

    // Ничего не уехало за край: горизонтальная прокрутка на телефоне — признак
    // вёрстки, которую не проверяли.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    // Почта оператора на узком экране скрыта: нужна она редко, а место занимает.
    await expect(page.locator('.shell__email')).toBeHidden();

    // По вкладкам ходить можно, и список сайтов тоже помещается.
    await page.getByRole('link', { name: 'Sites' }).click();
    // Ждём адрес, а не заголовок: под нагрузкой переход успевает занять больше
    // времени, чем обычные пять секунд ожидания, и заголовок ещё старый.
    await expect(page).toHaveURL(/\/dashboard\/sites/, { timeout: 20_000 });
    await expect(page.locator('.page__title')).toHaveText('Sites');

    const sitesOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(sitesOverflow).toBeLessThanOrEqual(1);
  });

  test('разговор можно закрыть и вернуть обратно', async ({ page, request }) => {
    const { first } = requireSites();
    const session = await startSession(request, first);
    await request.post(`${apiBase}/api/v1/handover`, { headers: authHeaders(session) });

    await signIn(page);
    await page.goto(`${WEB}/dashboard/conversations/${session.conversationId}`);

    await page.getByRole('button', { name: 'Close conversation' }).click();

    // Закрытый разговор уходит из очереди ожидающих и ждёт во вкладке «закрытые».
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
    await page.goto(`${WEB}/dashboard?filter=closed`);
    await expect(
      page.locator(`a[href="/dashboard/conversations/${session.conversationId}"]`),
    ).toBeVisible();

    // А это главное: закрытие обратимо. Иначе одна неверная кнопка уносила бы
    // переписку в архив навсегда.
    await page.goto(`${WEB}/dashboard/conversations/${session.conversationId}`);
    await page.getByRole('button', { name: 'Reopen conversation' }).click();
    await expect(page.getByRole('button', { name: 'Send reply' })).toBeVisible();
  });

  test('неверный текущий пароль не меняет пароль', async ({ page }) => {
    await signIn(page);
    await page.goto(`${WEB}/dashboard/account`);

    await page.getByLabel('Current password').fill('definitely-not-the-password');
    await page.getByLabel('New password', { exact: true }).fill('some-new-password-123');
    await page.getByLabel('Repeat new password').fill('some-new-password-123');
    await page.getByRole('button', { name: 'Change password' }).click();

    // Пароль не меняется — и об этом сказано прямо, а не молчанием.
    await expect(page.locator('.form__error')).toContainText('current password is not right');
  });

  test('новое пространство с сайтом и оператором изолировано от демонстрации', async ({ page }) => {
    // Проверка проходит весь путь: пространство, сайт, приглашение, вход, смена
    // пароля и уборка. Тридцати секунд ей мало на загруженной машине.
    test.slow();
    await signIn(page);

    // Уникальные имена: проверки не должны мешать друг другу при повторных прогонах.
    const stamp = Date.now();
    const workspaceName = `Test workspace ${String(stamp)}`;
    const siteName = `Test site ${String(stamp)}`;
    const email = `test-${String(stamp)}@example.com`;

    await page.goto(`${WEB}/dashboard/access`);

    // 1. Своё пространство.
    const createPanel = page.locator('.panel', { hasText: 'New workspace' });
    await createPanel.getByLabel('Name').fill(workspaceName);
    await createPanel.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page.getByText(workspaceName)).toBeVisible();

    // 2. Сайт в нём. Ключ генерирует сервер, и на странице сайта сразу лежит
    //    готовая строка вставки — то, зачем сайт и заводили.
    await page.goto(`${WEB}/dashboard/sites`);
    const sitePanel = page.locator('.panel', { hasText: 'New site' });
    await sitePanel.getByLabel('Name').fill(siteName);
    await sitePanel.getByLabel('Allowed origins, one per line').fill('https://example.com');
    await sitePanel.getByRole('button', { name: 'Create site' }).click();

    await expect(page.locator('.conversation__title')).toHaveText(siteName);
    const snippet = (await page.locator('.snippet').textContent()) ?? '';
    expect(snippet).toContain('data-site-id="pub_');
    expect(snippet).toContain('ecw-loader.iife.js');

    // 3. Оператор в пространство. Пароль показывается один раз — забираем здесь.
    await page.goto(`${WEB}/dashboard/access`);
    const panel = page.locator('.panel', { hasText: workspaceName });
    await panel.getByLabel('Email').fill(email);
    await panel.getByRole('button', { name: 'Invite' }).click();

    // Берём именно пароль: рядом лежит ещё и код восстановления, и без
    // различия по классу поиск нашёл бы оба.
    const secret = panel.locator('.form__code--password');
    await expect(secret).toBeVisible();
    const password = (await secret.textContent())?.trim() ?? '';
    expect(password.length).toBeGreaterThanOrEqual(12);

    // 4. Входим под новым оператором. Ради этого всё и делалось: его очередь
    //    пуста, потому что разговоры демонстрации лежат в другом пространстве,
    //    и для него их не существует.
    await page.getByRole('button', { name: 'Sign out' }).click();
    // Ждём именно перехода на вход: на странице доступов тоже есть поля
    // «Email», и поиск по ним без ожидания нашёл бы несколько.
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });

    await expect(page.locator('.queue__row')).toHaveCount(0);
    await expect(page.locator('.page__subtitle')).toContainText('Nobody is waiting');

    // 5. И меняет свой пароль: старый после этого не подходит.
    await page.goto(`${WEB}/dashboard/account`);
    const next = `${password.slice(0, 6)}-changed-password-1`;

    await page.getByLabel('Current password').fill(password);
    await page.getByLabel('New password', { exact: true }).fill(next);
    await page.getByLabel('Repeat new password').fill(next);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.locator('.form__secret')).toContainText('Password changed');

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(next);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });

    // 6. Уборка за собой: пространство удаляется владельцем, подтверждая именем.
    //    Проверка не должна оставлять мусор в панели после каждого прогона.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
    await signIn(page);

    await page.goto(`${WEB}/dashboard/access`);
    const own = page.locator('.panel', { hasText: workspaceName });
    await own.locator('summary').click();
    await own.getByLabel('Workspace name').fill(workspaceName);
    await own.getByRole('button', { name: 'Delete permanently' }).click();

    await expect(page.getByText(workspaceName)).toHaveCount(0);
  });
});

async function signIn(page: Page): Promise<void> {
  await page.goto(`${WEB}/login`);
  await page.getByLabel('Email').fill(OPERATOR.email);
  await page.getByLabel('Password').fill(OPERATOR.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
}

interface VisitorSession {
  token: string;
  conversationId: string;
  origin: string;
}

async function startSession(request: APIRequestContext, site: SeededSite): Promise<VisitorSession> {
  const origin = site.allowedOrigins[0] ?? '';
  const response = await request.post(`${apiBase}/api/v1/init`, {
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    data: { siteId: site.publicKey },
  });

  const body = (await response.json()) as InitResponseBody;
  return { token: body.token, conversationId: body.conversationId, origin };
}

function authHeaders(session: VisitorSession): Record<string, string> {
  return { Origin: session.origin, Authorization: `Bearer ${session.token}` };
}

async function listMessages(
  request: APIRequestContext,
  session: VisitorSession,
): Promise<MessagesResponseBody['messages']> {
  const response = await request.get(`${apiBase}/api/v1/messages?after=0`, {
    headers: authHeaders(session),
  });

  return ((await response.json()) as MessagesResponseBody).messages;
}
