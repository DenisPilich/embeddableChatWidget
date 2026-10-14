'use client';

import { useActionState } from 'react';
import { changePassword, type PasswordState } from './actions';

const INITIAL: PasswordState = { error: null, done: false };

export function PasswordForm({ minLength }: { minLength: number }) {
  const [state, action, pending] = useActionState(changePassword, INITIAL);

  return (
    <div className="invite">
      <form className="form" action={action}>
        <label className="form__field">
          <span>Current password</span>
          <input name="current" type="password" required autoComplete="current-password" />
        </label>

        <label className="form__field">
          <span>New password</span>
          <input
            name="next"
            type="password"
            required
            minLength={minLength}
            autoComplete="new-password"
          />
        </label>

        <label className="form__field">
          <span>Repeat new password</span>
          <input
            name="repeat"
            type="password"
            required
            minLength={minLength}
            autoComplete="new-password"
          />
        </label>

        <button className="form__submit" disabled={pending} type="submit">
          {pending ? 'Saving…' : 'Change password'}
        </button>
      </form>

      {state.error === null ? null : (
        <p className="form__error" role="alert">
          {state.error}
        </p>
      )}

      {state.done ? (
        <p className="form__secret" role="status">
          Password changed. Use it the next time you sign in.
        </p>
      ) : null}
    </div>
  );
}
