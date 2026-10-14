import type { Metadata } from 'next';
import Link from 'next/link';
import { requireOperator } from '@/lib/operator';
import { logout } from './actions';
import './dashboard.css';

export const metadata: Metadata = {
  title: 'Operator dashboard',
};

/**
 * Оболочка панели: шапка с навигацией, подписью оператора и выходом.
 *
 * Вынесена в общий макет, а не повторяется на каждой странице: во-первых, так
 * она одна, во-вторых, проверка входа происходит здесь ровно один раз — до того,
 * как отрисуется что-либо ещё. Забыть её на новой странице невозможно, потому
 * что новая страница без этого макета просто не соберётся.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const operator = await requireOperator();

  return (
    <div className="shell">
      <header className="shell__bar">
        <Link className="shell__brand" href="/dashboard">
          Chat&nbsp;widget
        </Link>

        <nav className="shell__nav">
          <Link className="shell__link" href="/dashboard">
            Conversations
          </Link>
          <Link className="shell__link" href="/dashboard/sites">
            Sites
          </Link>
          <Link className="shell__link" href="/dashboard/access">
            Access
          </Link>
        </nav>

        <div className="shell__who">
          {/* Кто вошёл — видно всегда: иначе на общей машине непонятно, чьи
              действия записываются. Нажатие ведёт к смене пароля. */}
          <Link className="shell__email" href="/dashboard/account" title={operator.email}>
            {operator.email}
          </Link>

          <form action={logout}>
            <button className="shell__signout" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>

      {children}
    </div>
  );
}
