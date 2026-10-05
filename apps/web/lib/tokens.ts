import { SignJWT, jwtVerify } from 'jose';

/**
 * Токен виджета.
 *
 * Виджет работает на чужой странице, поэтому обычные сессии с cookie не годятся:
 * cookie не отправить на наш домен с чужого сайта без разрешения браузера, а
 * сторонние cookie тот же Safari блокирует. Поэтому посетитель получает
 * подписанный токен и приносит его в заголовке.
 *
 * Токен умышленно узкий: в нём нет ничего, кроме идентификаторов сайта,
 * посетителя и диалога. Ни ролей, ни прав — их проверять не на чем, а лишние
 * данные в токене означают лишние данные, которые могут устареть.
 *
 * Подпись делается готовой библиотекой, а не своим кодом. Самодельная
 * криптография — классический источник дыр, и здесь нет ни одной причины её
 * писать: проверка подписи, срока и алгоритма уже написана и протестирована.
 */

const ALGORITHM = 'HS256';
const ISSUER = 'ecw';
const AUDIENCE = 'ecw-widget';

/**
 * Срок жизни токена.
 *
 * 12 часов — компромисс: посетитель может вернуться к разговору в тот же день и
 * не потерять переписку, но украденный токен живёт не вечно.
 */
const TTL_SECONDS = 60 * 60 * 12;

export interface WidgetTokenClaims {
  siteId: string;
  visitorId: string;
  conversationId: string;
}

function getSecret(): Uint8Array {
  const value = process.env.ECW_TOKEN_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      'Не задан ECW_TOKEN_SECRET длиной не меньше 32 символов — см. apps/web/.env.example',
    );
  }
  return new TextEncoder().encode(value);
}

export async function signWidgetToken(claims: WidgetTokenClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(getSecret());
}

/**
 * Проверяет токен и возвращает его содержимое.
 *
 * `algorithms` указан явно: без этого список допустимых алгоритмов берётся из
 * самого токена, и злоумышленник может подсунуть свой — известная ошибка
 * проверки JWT. Здесь принимается только HS256.
 */
export async function verifyWidgetToken(token: string): Promise<WidgetTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    const { siteId, visitorId, conversationId } = payload;
    if (
      typeof siteId !== 'string' ||
      typeof visitorId !== 'string' ||
      typeof conversationId !== 'string'
    ) {
      return null;
    }

    return { siteId, visitorId, conversationId };
  } catch {
    // Просроченный, подделанный или чужой токен — для нас просто «не наш».
    // Чем именно он плох, наружу не сообщаем: это подсказка тому, кто подбирает.
    return null;
  }
}
