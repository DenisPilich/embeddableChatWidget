import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentOperator } from '@/lib/operator';
import { PASSWORD_MIN_LENGTH } from '@/lib/password';
import { RecoverForm } from './recover-form';
import '../login/login.css';

export const metadata: Metadata = {
  title: 'Recover access',
};

export const dynamic = 'force-dynamic';

/**
 * Восстановление доступа по коду, выданному при заведении учётной записи.
 *
 * Почты у проекта нет намеренно: она потребовала бы чужого сервиса, ключа и
 * денег, а восстановление нужно ровно в тот момент, когда доступа нет. Код,
 * который человек хранит у себя, решает ту же задачу без зависимости.
 */
export default async function RecoverPage() {
  // Вошедшему здесь делать нечего: он и так внутри.
  if ((await currentOperator()) !== null) redirect('/dashboard');

  return (
    <main className="login">
      <h1 className="login__title">Recover access</h1>

      <p className="login__help">
        Enter the email you signed in with and the recovery code you were given when the account was
        created. Then choose a new password.
      </p>

      <RecoverForm minLength={PASSWORD_MIN_LENGTH} />

      <p className="login__help">
        No code? Someone in your workspace with owner rights can invite you again — but only if the
        account does not exist yet. <a href="/login">Back to sign in</a>.
      </p>
    </main>
  );
}
