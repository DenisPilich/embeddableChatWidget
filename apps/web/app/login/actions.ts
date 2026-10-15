'use server';

import { redirect } from 'next/navigation';
import { findUserByEmail } from '@/lib/data';
import { verifyPassword } from '@/lib/password';
import { createOperatorSession } from '@/lib/session';

/**
 * Вход оператора.
 *
 * Две одинаковые ошибки на разные случаи — намеренно. Разные формулировки
 * («нет такого пользователя» и «неверный пароль») превращают форму входа в
 * способ узнать, кто зарегистрирован.
 *
 * Сам вход — серверное действие, а не отдельный обработчик: форма работает даже
 * без JavaScript, а нам не нужно ни токена в браузере, ни лишнего адреса.
 */
export async function login(form: FormData): Promise<void> {
  const email = field(form, 'email');
  const password = field(form, 'password');

  const user = await findUserByEmail(email);
  const valid = user !== null && (await verifyPassword(password, user.passwordHash));

  if (!valid) {
    console.warn('[ecw] неудачный вход в панель', { email });
    redirect('/login?error=1');
  }

  // Поколение сессий кладём в cookie: смена и восстановление пароля его
  // увеличивают, и выданное раньше перестаёт подходить.
  await createOperatorSession(user.id, user.sessionVersion);
  redirect('/dashboard');
}

/**
 * Значение поля формы строкой.
 *
 * `form.get` возвращает ещё и файл, и приведение через `String` превратило бы
 * его в `[object File]` — молча и непонятно.
 */
function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}
