'use server';

import { findUserByEmail, setRecoveryHash, updatePassword } from '@/lib/data';
import {
  PASSWORD_MIN_LENGTH,
  generateRecoveryCode,
  hashPassword,
  verifyPassword,
} from '@/lib/password';

/**
 * Восстановление доступа по коду.
 *
 * Код выдаётся один раз при заведении учётной записи и хранится у человека, а не
 * у сервиса: почты у нас нет, а заводить чужой сервис ради писем — лишняя
 * зависимость. Код длиной в тридцать два символа перебрать нельзя, поэтому
 * ограничителя частоты здесь нет — в отличие от формы входа, где перебирают
 * пароли.
 *
 * Одна формулировка на все неудачи — намеренно: разные ответы («нет такой
 * почты» и «код не тот») превратили бы форму в способ узнать, у кого есть
 * учётная запись.
 */

export interface RecoverState {
  error: string | null;
  /** Новый код восстановления. Прежний после успеха не работает. */
  recoveryCode: string | null;
}

export async function recover(_previous: RecoverState, form: FormData): Promise<RecoverState> {
  const email = field(form, 'email');
  const code = field(form, 'code');
  const password = field(form, 'password');
  const repeat = field(form, 'repeat');

  const refusal = 'The email or the recovery code is not right.';

  const user = await findUserByEmail(email);
  if (user === null) return { error: refusal, recoveryCode: null };

  // Проверка кода — тем же сравнением с постоянным временем, что и пароля.
  if (!(await verifyPassword(code, user.recoveryHash))) {
    console.warn('[ecw] восстановление доступа: код не подошёл', { email });
    return { error: refusal, recoveryCode: null };
  }

  if (password !== repeat) {
    return { error: 'The new passwords do not match.', recoveryCode: null };
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      error: `Use at least ${String(PASSWORD_MIN_LENGTH)} characters.`,
      recoveryCode: null,
    };
  }

  // Пароль меняется вместе с поколением сессий: все, кто вошёл раньше, выходят.
  // Для восстановления это главное — иначе тот, кто получил доступ, остался бы
  // в панели и после смены пароля.
  await updatePassword({ userId: user.id, passwordHash: await hashPassword(password) });

  // Код одноразовый: прежний больше не подойдёт, а новый показывается один раз.
  const recoveryCode = generateRecoveryCode();
  await setRecoveryHash({ userId: user.id, recoveryHash: await hashPassword(recoveryCode) });

  console.info('[ecw] доступ восстановлен по коду', { userId: user.id });

  return { error: null, recoveryCode };
}

/** `form.get` возвращает ещё и файл: приведение через `String` дало бы `[object File]`. */
function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}
