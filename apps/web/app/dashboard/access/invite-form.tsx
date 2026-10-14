'use client';

import { useActionState } from 'react';
import { invite, type InviteState } from './actions';

const INITIAL: InviteState = { password: null, email: null, error: null };

/**
 * Приглашение оператора.
 *
 * Сгенерированный пароль показывается ровно один раз — в ответе на это действие.
 * Он не попадает ни в адрес страницы, ни в журнал, ни в базу в открытом виде:
 * перезагрузка страницы его теряет, и это правильно. Владелец не должен уметь
 * вернуться и посмотреть чужой пароль ещё раз.
 */
export function InviteForm({ workspaceId }: { workspaceId: string }) {
  const [state, action, pending] = useActionState(invite.bind(null, workspaceId), INITIAL);

  return (
    <div className="invite">
      <form className="form form--inline" action={action}>
        <label className="form__field">
          <span>Email</span>
          <input name="email" type="email" required autoComplete="off" />
        </label>

        <label className="form__field">
          <span>Name</span>
          <input name="name" maxLength={80} autoComplete="off" />
        </label>

        <label className="form__field form__field--narrow">
          <span>Role</span>
          <select name="role" defaultValue="AGENT">
            <option value="AGENT">Agent</option>
            <option value="ADMIN">Admin</option>
          </select>
        </label>

        <button className="form__submit" disabled={pending} type="submit">
          {pending ? 'Inviting…' : 'Invite'}
        </button>
      </form>

      {state.error === null ? null : (
        <p className="form__error" role="alert">
          {state.error}
        </p>
      )}

      {state.password === null ? null : (
        <p className="form__secret" role="status">
          Password for <strong>{state.email}</strong>: <code>{state.password}</code>
          <br />
          Copy it now and pass it on in person. It is shown once and is not stored anywhere in
          readable form.
        </p>
      )}
    </div>
  );
}
