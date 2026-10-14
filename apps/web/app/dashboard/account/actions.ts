'use server';

import { findUserById, updatePassword } from '@/lib/data';
import { requireOperator } from '@/lib/operator';
import { PASSWORD_MIN_LENGTH, hashPassword, verifyPassword } from '@/lib/password';

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

  await updatePassword({ userId: operator.id, passwordHash: await hashPassword(next) });

  return { error: null, done: true };
}

/** `form.get` возвращает ещё и файл: приведение через `String` дало бы `[object File]`. */
function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}
