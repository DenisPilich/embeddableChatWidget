'use server';

import { findUserById, setRecoveryHash, updatePassword } from '@/lib/data';
import { requireOperator } from '@/lib/operator';
import {
  PASSWORD_MIN_LENGTH,
  generateRecoveryCode,
  hashPassword,
  verifyPassword,
} from '@/lib/password';
import { createOperatorSession } from '@/lib/session';

/**
 * Смена своего пароля.
 *
 * Старый пароль спрашиваем обязательно, хотя человек уже вошёл: сессия живёт
 * двенадцать часов, и за это время к открытому компьютеру может подойти кто
 * угодно. Смена пароля — единственное действие в панели с такими последствиями.
 *
 * Чего здесь нет и о чём стоит знать: смена пароля не разлогинивает другие
 * сессии. Cookie подписана и живёт своей жизнью, списка сессий у нас нет.
 */

export interface PasswordState {
  error: string | null;
  done: boolean;
}

export async function changePassword(
  _previous: PasswordState,
  form: FormData,
): Promise<PasswordState> {
  const operator = await requireOperator();

  const current = field(form, 'current');
  const next = field(form, 'next');
  const repeat = field(form, 'repeat');

  const user = await findUserById(operator.id);
  const correct = user !== null && (await verifyPassword(current, user.passwordHash));

  if (!correct) {
    return { error: 'The current password is not right.', done: false };
  }

  if (next !== repeat) {
    return { error: 'The new passwords do not match.', done: false };
  }

  if (next.length < PASSWORD_MIN_LENGTH) {
    return { error: `Use at least ${String(PASSWORD_MIN_LENGTH)} characters.`, done: false };
  }

  if (next === current) {
    return { error: 'The new password is the same as the current one.', done: false };
  }

  // Поколение сессий увеличивается — и своей сессии выдаём свежую сразу:
  // иначе, сменив пароль, человек выгнал бы и себя. Все прочие входы при этом
  // перестают работать, ради чего всё и делается.
  const version = await updatePassword({
    userId: operator.id,
    passwordHash: await hashPassword(next),
  });
  await createOperatorSession(operator.id, version);

  return { error: null, done: true };
}

export interface RecoveryState {
  /** Новый код восстановления. Показывается один раз. */
  code: string | null;
}

/**
 * Выдаёт новый код восстановления.
 *
 * Прежний перестаёт работать — иначе копия, забытая в переписке, оставалась бы
 * ключом навсегда. Код не показывается повторно: только здесь и только раз.
 */
export async function rotateRecoveryCode(): Promise<RecoveryState> {
  const operator = await requireOperator();

  const code = generateRecoveryCode();
  await setRecoveryHash({ userId: operator.id, recoveryHash: await hashPassword(code) });

  return { code };
}

/** `form.get` возвращает ещё и файл: приведение через `String` дало бы `[object File]`. */
function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}
