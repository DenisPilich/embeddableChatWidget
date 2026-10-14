import type { Metadata } from 'next';
import { requireOperator } from '@/lib/operator';
import { PASSWORD_MIN_LENGTH } from '@/lib/password';
import { PasswordForm } from './password-form';
import '../dashboard.css';

export const metadata: Metadata = {
  title: 'Account',
};

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const operator = await requireOperator();

  return (
    <main className="page">
      <header className="page__bar">
        <h1 className="page__title">Account</h1>
        <p className="page__subtitle">{operator.email}</p>
      </header>

      <section className="panel">
        <h2 className="panel__title">Change password</h2>
        <p className="panel__note">
          At least {PASSWORD_MIN_LENGTH} characters. The current password is asked for even though
          you are already signed in: sessions last twelve hours, and a computer left open is a real
          thing.
        </p>
        <PasswordForm minLength={PASSWORD_MIN_LENGTH} />
      </section>
    </main>
  );
}
