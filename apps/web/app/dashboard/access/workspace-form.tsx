'use client';

import { useActionState } from 'react';
import { createWorkspace } from './actions';

const INITIAL = { error: null };

/**
 * Новое рабочее пространство.
 *
 * Нужно ровно для одного: разделить демонстрацию и настоящую работу. Публичный
 * демо-логин остаётся у демонстрации, а свои сайты живут в своём пространстве,
 * куда посторонний не попадёт.
 */
export function WorkspaceForm() {
  const [state, action, pending] = useActionState(createWorkspace, INITIAL);

  return (
    <div className="invite">
      <form className="form form--inline" action={action}>
        <label className="form__field">
          <span>Name</span>
          <input name="name" placeholder="My projects" required minLength={2} maxLength={80} />
        </label>

        <button className="form__submit" disabled={pending} type="submit">
          {pending ? 'Creating…' : 'Create workspace'}
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
