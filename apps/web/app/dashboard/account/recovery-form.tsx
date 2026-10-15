'use client';

import { useActionState } from 'react';
import { rotateRecoveryCode, type RecoveryState } from './actions';

const INITIAL: RecoveryState = { code: null };

/**
 * Новый код восстановления.
 *
 * Показывается один раз и только здесь. Прежний код после этого не работает —
 * иначе копия, забытая в чужой переписке, оставалась бы ключом к учётной записи
 * навсегда.
 */
export function RecoveryForm() {
  const [state, action, pending] = useActionState(rotateRecoveryCode, INITIAL);

  return (
    <div className="invite">
      <form className="form form--inline" action={action}>
        <button className="form__submit" disabled={pending} type="submit">
          {pending ? 'Generating…' : 'Get a new recovery code'}
        </button>
      </form>

      {state.code === null ? null : (
        <p className="form__secret" role="status">
          Your new recovery code:{' '}
          <code className="form__code form__code--recovery">{state.code}</code>
          <br />
          Save it somewhere safe and offline. The previous code no longer works, and this one will
          not be shown again.
        </p>
      )}
    </div>
  );
}
