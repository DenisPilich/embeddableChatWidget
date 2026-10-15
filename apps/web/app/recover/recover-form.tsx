'use client';

import { useActionState } from 'react';
import { recover, type RecoverState } from './actions';

const INITIAL: RecoverState = { error: null, recoveryCode: null };

/**
 * Форма восстановления доступа.
 *
 * Новый код показывается один раз после успеха: прежний перестал работать, и
 * потерять новый — значит потерять единственный способ вернуться. Поэтому
 * предупреждение рядом, а не в документации.
 */
export function RecoverForm({ minLength }: { minLength: number }) {
  const [state, action, pending] = useActionState(recover, INITIAL);

  return (
    <>
      <form className="login__form" action={action}>
        <label className="login__field">
          <span>Email</span>
          <input name="email" type="email" required autoComplete="username" />
        </label>

        <label className="login__field">
          <span>Recovery code</span>
          <input name="code" required autoComplete="off" spellCheck={false} />
        </label>

        <label className="login__field">
          <span>New password</span>
          <input
            name="password"
            type="password"
            required
            minLength={minLength}
            autoComplete="new-password"
          />
        </label>

        <label className="login__field">
          <span>Repeat new password</span>
          <input
            name="repeat"
            type="password"
            required
            minLength={minLength}
            autoComplete="new-password"
          />
        </label>

        <button className="login__submit" disabled={pending} type="submit">
          {pending ? 'Restoring…' : 'Set a new password'}
        </button>
      </form>

      {state.error === null ? null : (
        <p className="login__error" role="alert">
          {state.error}
        </p>
      )}

      {state.recoveryCode === null ? null : (
        <p className="login__secret" role="status">
          Password changed. Your new recovery code:{' '}
          <code className="login__code login__code--recovery">{state.recoveryCode}</code>
          <br />
          Save it now: the old one no longer works, and this is the only time it is shown.{' '}
          <a href="/login">Go to sign in</a>.
        </p>
      )}
    </>
  );
}
