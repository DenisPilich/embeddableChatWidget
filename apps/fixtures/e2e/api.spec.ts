import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import {
  apiBase,
  readSeed,
  requireSites,
  type InitResponseBody,
  type MessagesResponseBody,
  type SendResponseBody,
} from './api-helpers';

/**
 * Проверки API виджета.
 *
 * Пропускаются, если база не наполнена: без неё проверять нечего, а падающие
 * всегда тесты приучают не смотреть на красное.
 */
test.describe('API виджета', () => {
  test.skip(!readSeed(), 'нет данных наполнения: pnpm --filter @ecw/web db:seed');

  test('предварительный запрос браузера разрешает источник', async ({ request }) => {
    const { first } = requireSites();

    const response = await request.fetch(`${apiBase}/api/v1/init`, {
      method: 'OPTIONS',
      headers: {
        Origin: first.allowedOrigins[0] ?? '',
        'Access-Control-Request-Method': 'POST',
      },
    });

    expect(response.status()).toBe(204);
    expect(response.headers()['access-control-allow-origin']).toBe(first.allowedOrigins[0]);
    expect(response.headers()['access-control-allow-headers']).toContain('Authorization');
  });

  test('с разрешённого домена выдаётся токен', async ({ request }) => {
    const { first } = requireSites();

    const response = await request.post(`${apiBase}/api/v1/init`, {
      headers: { Origin: first.allowedOrigins[0] ?? '' },
      data: { siteId: first.publicKey },
    });

    expect(response.status()).toBe(200);
    const body = (await response.json()) as InitResponseBody;
    expect(body.token).toBeTruthy();
    expect(body.conversationId).toBeTruthy();

    // Содержимое токена подписано, но не зашифровано: его читает кто угодно.
    // Убеждаемся, что там нет ничего лишнего — только идентификаторы.
    const claims = decodeTokenPayload(body.token);
    expect(Object.keys(claims).sort()).toEqual(
      ['aud', 'conversationId', 'exp', 'iat', 'iss', 'siteId', 'visitorId'].sort(),
    );
  });

  test('посторонний домен отклоняется', async ({ request }) => {
    const { first } = requireSites();

    const response = await request.post(`${apiBase}/api/v1/init`, {
      headers: { Origin: 'https://evil.example' },
      data: { siteId: first.publicKey },
    });

    expect(response.status()).toBe(403);
    expect((await response.json()) as { error: string }).toMatchObject({
      error: 'origin_not_allowed',
    });
  });

  test('ключ второго сайта с домена первого не работает', async ({ request }) => {
    const { first, second } = requireSites();

    const response = await request.post(`${apiBase}/api/v1/init`, {
      headers: { Origin: first.allowedOrigins[0] ?? '' },
      data: { siteId: second.publicKey },
    });

    expect(response.status()).toBe(403);
  });

  test('неизвестный сайт и мусор в теле различаются по коду', async ({ request }) => {
    const { first } = requireSites();
    const origin = first.allowedOrigins[0] ?? '';

    const unknown = await request.post(`${apiBase}/api/v1/init`, {
      headers: { Origin: origin },
      data: { siteId: 'pub_нет_такого_ключа' },
    });
    expect(unknown.status()).toBe(404);
    expect((await unknown.json()) as { error: string }).toMatchObject({ error: 'unknown_site' });

    const broken = await request.post(`${apiBase}/api/v1/init`, {
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      data: 'это не json',
    });
    expect(broken.status()).toBe(400);
  });

  test('вернувшийся посетитель попадает в тот же диалог', async ({ request }) => {
    const { first } = requireSites();
    const origin = first.allowedOrigins[0] ?? '';

    const firstInit = (await (
      await request.post(`${apiBase}/api/v1/init`, {
        headers: { Origin: origin },
        data: { siteId: first.publicKey },
      })
    ).json()) as InitResponseBody;

    const secondInit = (await (
      await request.post(`${apiBase}/api/v1/init`, {
        headers: { Origin: origin },
        data: { siteId: first.publicKey, visitorToken: firstInit.token },
      })
    ).json()) as InitResponseBody;

    expect(secondInit.conversationId).toBe(firstInit.conversationId);
    expect(decodeTokenPayload(secondInit.token).visitorId).toBe(
      decodeTokenPayload(firstInit.token).visitorId,
    );
  });

  test('токен одного сайта не открывает ничего на другом', async ({ request }) => {
    const { first, second } = requireSites();

    const fromFirst = (await (
      await request.post(`${apiBase}/api/v1/init`, {
        headers: { Origin: first.allowedOrigins[0] ?? '' },
        data: { siteId: first.publicKey },
      })
    ).json()) as InitResponseBody;

    const onSecond = (await (
      await request.post(`${apiBase}/api/v1/init`, {
        headers: { Origin: second.allowedOrigins[0] ?? '' },
        data: { siteId: second.publicKey, visitorToken: fromFirst.token },
      })
    ).json()) as InitResponseBody;

    expect(decodeTokenPayload(onSecond.token).siteId).toBe(second.id);
    expect(decodeTokenPayload(onSecond.token).visitorId).not.toBe(
      decodeTokenPayload(fromFirst.token).visitorId,
    );
    expect(onSecond.conversationId).not.toBe(fromFirst.conversationId);
  });

  test('сообщение записывается, а ассистент отвечает', async ({ request }) => {
    const { first } = requireSites();
    const session = await startSession(request, first.publicKey, first.allowedOrigins[0] ?? '');

    const sent = await sendMessage(request, session, 'во сколько вы работаете?', 'client-1');
    expect(sent.message.seq).toBeGreaterThan(0);
    expect(sent.duplicate).toBe(false);
    expect(sent.message.authorKind).toBe('visitor');

    const all = await listMessages(request, session, 0);
    const authors = all.messages.map((message) => message.authorKind);
    expect(authors).toContain('visitor');
    // Ответ ассистента — такое же сообщение в диалоге, с настоящим номером.
    expect(authors).toContain('ai');
  });

  test('курсор отдаёт только то, что после указанного номера', async ({ request }) => {
    const { first } = requireSites();
    const session = await startSession(request, first.publicKey, first.allowedOrigins[0] ?? '');

    await sendMessage(request, session, 'первое сообщение', 'курсор-1');
    await sendMessage(request, session, 'второе сообщение', 'курсор-2');
    await sendMessage(request, session, 'третье сообщение', 'курсор-3');

    const all = await listMessages(request, session, 0);
    const ordered = [...all.messages].sort((left, right) => left.seq - right.seq);
    expect(ordered.length).toBeGreaterThanOrEqual(4);
    expect(all.lastSeq).toBe(ordered.at(-1)?.seq);

    // Всё, что после второго по счёту сообщения, — ровно остаток списка.
    const middle = ordered[1]?.seq ?? 0;
    const rest = await listMessages(request, session, middle);
    expect(rest.messages.map((message) => message.seq)).toEqual(
      ordered.slice(2).map((message) => message.seq),
    );

    // После последнего известного номера нового нет.
    const nothing = await listMessages(request, session, all.lastSeq);
    expect(nothing.messages).toEqual([]);
  });

  test('повторная отправка не создаёт второе сообщение', async ({ request }) => {
    const { first } = requireSites();
    const session = await startSession(request, first.publicKey, first.allowedOrigins[0] ?? '');

    const clientId = 'повтор-один-и-тот-же';
    const text = 'написано однажды';

    const firstTry = await sendMessage(request, session, text, clientId);
    const secondTry = await sendMessage(request, session, text, clientId);

    expect(firstTry.duplicate).toBe(false);
    expect(secondTry.duplicate).toBe(true);
    expect(secondTry.message.id).toBe(firstTry.message.id);

    // Главное: в переписке ровно одна копия этого текста, а не две.
    const after = await listMessages(request, session, 0);
    expect(after.messages.filter((message) => message.body === text).length).toBe(1);
  });

  test('без токена и с испорченным токеном доступа нет', async ({ request }) => {
    const { first } = requireSites();
    const origin = first.allowedOrigins[0] ?? '';

    const noToken = await request.post(`${apiBase}/api/v1/messages`, {
      headers: { Origin: origin },
      data: { clientId: 'x', body: 'привет' },
    });
    expect(noToken.status()).toBe(401);

    // Токен только латиницей: в заголовках HTTP кириллица недопустима, и
    // попытка её отправить падает ещё до запроса.
    const badToken = await request.post(`${apiBase}/api/v1/messages`, {
      headers: { Origin: origin, Authorization: 'Bearer not.a.real.token' },
      data: { clientId: 'x', body: 'привет' },
    });
    expect(badToken.status()).toBe(401);

    const noTokenRead = await request.get(`${apiBase}/api/v1/messages`, {
      headers: { Origin: origin },
    });
    expect(noTokenRead.status()).toBe(401);
  });

  test('переписка разных сайтов не смешивается', async ({ request }) => {
    const { first, second } = requireSites();

    const sessionA = await startSession(request, first.publicKey, first.allowedOrigins[0] ?? '');
    const sessionB = await startSession(request, second.publicKey, second.allowedOrigins[0] ?? '');

    const marker = `только-для-первого-${Date.now()}`;
    await sendMessage(request, sessionA, marker, `client-a-${Date.now()}`);

    const listB = await listMessages(request, sessionB, 0);
    expect(listB.messages.map((message) => message.body)).not.toContain(marker);

    const listA = await listMessages(request, sessionA, 0);
    expect(listA.messages.map((message) => message.body)).toContain(marker);
  });

  test('пустое и слишком длинное сообщение отклоняются', async ({ request }) => {
    const { first } = requireSites();
    const session = await startSession(request, first.publicKey, first.allowedOrigins[0] ?? '');

    const empty = await request.post(`${apiBase}/api/v1/messages`, {
      headers: { Origin: session.origin, Authorization: `Bearer ${session.token}` },
      data: { clientId: 'empty-1', body: '    ' },
    });
    expect(empty.status()).toBe(400);
    expect((await empty.json()) as { error: string }).toMatchObject({ error: 'empty_message' });

    const tooLong = await request.post(`${apiBase}/api/v1/messages`, {
      headers: { Origin: session.origin, Authorization: `Bearer ${session.token}` },
      data: { clientId: 'long-1', body: 'я'.repeat(5000) },
    });
    expect(tooLong.status()).toBe(400);
  });
});

// ── Вспомогательное ─────────────────────────────────────────────────────────

interface Session {
  token: string;
  conversationId: string;
  origin: string;
}

async function startSession(
  request: APIRequestContext,
  publicKey: string,
  origin: string,
): Promise<Session> {
  const response = await request.post(`${apiBase}/api/v1/init`, {
    headers: { Origin: origin },
    data: { siteId: publicKey },
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as InitResponseBody;
  return { token: body.token, conversationId: body.conversationId, origin };
}

async function sendMessage(
  request: APIRequestContext,
  session: Session,
  body: string,
  clientId: string,
): Promise<SendResponseBody> {
  const response = await request.post(`${apiBase}/api/v1/messages`, {
    headers: { Origin: session.origin, Authorization: `Bearer ${session.token}` },
    data: { clientId, body },
  });
  expect([200, 201]).toContain(response.status());
  return (await response.json()) as SendResponseBody;
}

async function listMessages(
  request: APIRequestContext,
  session: Session,
  after: number,
): Promise<MessagesResponseBody> {
  const response = await request.get(`${apiBase}/api/v1/messages?after=${after}`, {
    headers: { Origin: session.origin, Authorization: `Bearer ${session.token}` },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as MessagesResponseBody;
}

/** Разбирает полезную нагрузку токена. Подпись не проверяем — это делает сервер. */
function decodeTokenPayload(token: string): Record<string, unknown> {
  const part = token.split('.')[1] ?? '';
  const padded = part.replace(/-/g, '+').replace(/_/g, '/');
  const json = Buffer.from(padded, 'base64').toString('utf8');
  return JSON.parse(json) as Record<string, unknown>;
}
