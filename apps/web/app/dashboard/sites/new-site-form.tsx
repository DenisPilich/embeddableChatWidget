'use client';

import { useActionState } from 'react';
import { addSite, type AddSiteState } from './actions';

const INITIAL: AddSiteState = { error: null };

/**
 * Новый сайт в рабочем пространстве.
 *
 * Ключ сайта здесь не спрашивается: он должен быть случайным, поэтому его
 * генерирует сервер. Придуманный человеком ключ рано или поздно совпадёт с чужим,
 * и переписка одного сайта польётся в другой.
 */
export function NewSiteForm({ workspaces }: { workspaces: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(addSite, INITIAL);
  const first = workspaces[0]?.id ?? '';

  return (
    <div className="invite">
      <form className="form" action={action}>
        {workspaces.length > 1 ? (
          <label className="form__field">
            <span>Workspace</span>
            <select name="workspaceId" defaultValue={first}>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          // Выбирать не из чего, но значение форме нужно.
          <input name="workspaceId" type="hidden" value={first} />
        )}

        <label className="form__field">
          <span>Name</span>
          <input name="name" required minLength={2} maxLength={80} placeholder="My portfolio" />
        </label>

        <label className="form__field">
          <span>Allowed origins, one per line</span>
          <textarea
            className="form__input"
            name="origins"
            rows={3}
            placeholder="https://my-portfolio.vercel.app"
          />
          <small className="form__hint">
            Only these addresses may use the key. Without the list the widget will not connect
            anywhere.
          </small>
        </label>

        <button className="form__submit" disabled={pending} type="submit">
          {pending ? 'Creating…' : 'Create site'}
        </button>
      </form>

      {state.error === null ? null : (
        <p className="form__error" role="alert">
          {state.error}
        </p>
      )}
    </div>
  );
}
