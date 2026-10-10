import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Пароли операторов.
 *
 * `scrypt` из стандартной библиотеки Node, а не сторонняя библиотека: он
 * предназначен именно для паролей (в отличие от быстрых хешей вроде SHA-256,
 * которые для этого не годятся — их слишком быстро перебирать), и его не нужно
 * устанавливать.
 *
 * Формат хранения — `scrypt:соль:хеш`. Соль лежит рядом с хешем, а не в
 * отдельной колонке: так её невозможно потерять при копировании строки.
 */

const KEY_LENGTH = 64;
const SALT_BYTES = 16;

const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES).toString('hex');
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;

  return `scrypt:${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  // У оператора может не быть пароля вовсе — например, если его завели, но
  // вход ещё не настроили. Это не ошибка, это «войти нельзя».
  if (stored === null) return false;

  const [scheme, salt, hash] = stored.split(':');
  if (scheme !== 'scrypt' || salt === undefined || hash === undefined) return false;

  const expected = Buffer.from(hash, 'hex');
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;

  // Сравнение с постоянным временем: обычное `===` прекращает проверку на первом
  // несовпавшем байте и по времени ответа подсказывает, сколько угадано.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
