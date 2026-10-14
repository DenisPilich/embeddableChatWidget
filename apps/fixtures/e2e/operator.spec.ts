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
    await expect(page).toHaveURL(/\/login/);
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

    await page.getByLabel('Reply as operator').fill('A human is here now.');
    await page.getByRole('button', { name: 'Send reply' }).click();

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

    await page.goto(`${WEB}/dashboard?filter=waiting`);

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
  });

  test('разговор можно закрыть и вернуть обратно', async ({ page, request }) => {
    const { first } = requireSites();
    const session = await startSession(request, first);
    await request.post(`${apiBase}/api/v1/handover`, { headers: authHeaders(session) });

    await signIn(page);
    await page.goto(`${WEB}/dashboard/conversations/${session.conversationId}`);

    await page.getByRole('button', { name: 'Close conversation' }).click();

    // Закрытый разговор уходит из очереди ожидающих и ждёт во вкладке «закрытые».
    await expect(page).toHaveURL(/\/dashboard$/);
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

  test('новое пространство с новым оператором не видит разговоров демонстрации', async ({
    page,
  }) => {
    await signIn(page);

    // Уникальные имена, чтобы проверки не мешали друг другу при повторных прогонах.
    const stamp = Date.now();
    const workspaceName = `Test workspace ${String(stamp)}`;
    const email = `test-${String(stamp)}@example.com`;

    await page.goto(`${WEB}/dashboard/access`);

    // 1. Своё пространство.
    const createPanel = page.locator('.panel', { hasText: 'New workspace' });
    await createPanel.getByLabel('Name').fill(workspaceName);
    await createPanel.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page.getByText(workspaceName)).toBeVisible();

    // 2. Оператор в него. Пароль показывается один раз — забираем его здесь.
    const panel = page.locator('.panel', { hasText: workspaceName });
    await panel.getByLabel('Email').fill(email);
    await panel.getByRole('button', { name: 'Invite' }).click();

    const secret = panel.locator('.form__secret code');
    await expect(secret).toBeVisible();
    const password = (await secret.textContent())?.trim() ?? '';
    expect(password.length).toBeGreaterThanOrEqual(12);

    // 3. Входим под новым оператором. Ради этого всё и делалось: его очередь
    //    пуста, потому что разговоры демонстрации лежат в другом пространстве,
    //    и для него их не существует.
    await page.getByRole('button', { name: 'Sign out' }).click();
    // Ждём именно перехода на вход: на странице доступов тоже есть поля
    // «Email», и поиск по ним без ожидания нашёл бы несколько.
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await expect(page.locator('.queue__row')).toHaveCount(0);
    await expect(page.locator('.page__subtitle')).toContainText('Nobody is waiting');

    // 4. И меняет свой пароль: старый после этого не подходит.
    await page.goto(`${WEB}/dashboard/account`);
    const next = `${password.slice(0, 6)}-changed-password-1`;

    await page.getByLabel('Current password').fill(password);
    await page.getByLabel('New password', { exact: true }).fill(next);
    await page.getByLabel('Repeat new password').fill(next);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.locator('.form__secret')).toContainText('Password changed');

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(next);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});

async function signIn(page: Page): Promise<void> {
  await page.goto(`${WEB}/login`);
  await page.getByLabel('Email').fill(OPERATOR.email);
  await page.getByLabel('Password').fill(OPERATOR.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
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
