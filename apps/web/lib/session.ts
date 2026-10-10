import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

/**
 * Сессия оператора.
 *
 * В отличие от токена виджета, здесь обычная cookie: панель открывают на нашем
 * домене, и сторонних ограничений, из-за которых виджету пришлось отказаться от
 * cookie, тут нет.
 *
 * Cookie подписана, но не зашифрована: в ней лежит только идентификатор
 * оператора. Ни ролей, ни прав — их проверяют по базе на каждом запросе, потому
 * что права меняются, а выданная когда-то cookie об этом не узнает.
 *
 * `httpOnly` обязателен: сессия не должна быть доступна чужому скрипту на той же
 * странице. `sameSite: lax` — защита от подделки запросов с других сайтов.
 */

const COOKIE_NAME = 'ecw_operator';
const AUDIENCE = 'ecw-operator';
const ISSUER = 'ecw';
const ALGORITHM = 'HS256';

/** Двенадцать часов: рабочий день оператора. */
const TTL_SECONDS = 60 * 60 * 12;

function secret(): Uint8Array {
  const value = process.env.ECW_TOKEN_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      'Не задан ECW_TOKEN_SECRET длиной не меньше 32 символов — см. apps/web/.env.example',
    );
  }
  return new TextEncoder().encode(value);
}

export async function createOperatorSession(userId: string): Promise<void> {
  const token = await new SignJWT({ userId })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuer(ISSUER)
    // Отдельная аудитория: токен виджета нельзя предъявить как сессию оператора,
    // даже если подпись верна — подписаны они одним секретом.
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${String(TTL_SECONDS)}s`)
    .sign(secret());

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: TTL_SECONDS,
  });
}

/** Идентификатор вошедшего оператора или `null`. */
export async function readOperatorSession(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    return typeof payload.userId === 'string' ? payload.userId : null;
  } catch {
    // Просроченная или подделанная cookie — для нас просто «не вошёл».
    return null;
  }
}

export async function destroyOperatorSession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
