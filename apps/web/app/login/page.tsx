import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentOperator } from '@/lib/operator';
import { login } from './actions';
import './login.css';

export const metadata: Metadata = {
  title: 'Operator sign in',
};

// Страница зависит от cookie и базы, поэтому статически её собирать нечего.
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // Вошедшему страница входа не нужна.
  if ((await currentOperator()) !== null) redirect('/dashboard');

  const { error } = await searchParams;

  return (
    <main className="login">
      <h1 className="login__title">Operator sign in</h1>

      {error === undefined ? null : (
        // role="alert" — чтобы программа чтения с экрана сообщила об ошибке
        // сразу, а не после того, как человек дошёл до неё сам.
        <p className="login__error" role="alert">
          Wrong email or password.
        </p>
      )}

      <form className="login__form" action={login}>
        <label className="login__field">
          <span>Email</span>
          <input name="email" type="email" required autoComplete="username" />
        </label>

        <label className="login__field">
          <span>Password</span>
          <input name="password" type="password" required autoComplete="current-password" />
        </label>

        <button className="login__submit" type="submit">
          Sign in
        </button>
      </form>
    </main>
  );
}
