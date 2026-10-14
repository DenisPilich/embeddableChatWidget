import type { Metadata } from 'next';
import Link from 'next/link';
import { listOperatorSites } from '@/lib/data';
import { requireOperator } from '@/lib/operator';
import '../dashboard.css';

export const metadata: Metadata = {
  title: 'Sites',
};

export const dynamic = 'force-dynamic';

/**
 * Список сайтов оператора.
 *
 * Раньше он был приклеен к очереди разговоров, хотя это разные вещи: очередь —
 * про людей, которые ждут ответа, а сайты — про настройки. Теперь это отдельная
 * страница, и очередь занимается только своим делом.
 */
export default async function SitesPage() {
  const operator = await requireOperator();
  const sites = await listOperatorSites({ workspaceIds: operator.workspaceIds });

  return (
    <main className="page">
      <header className="page__bar">
        <h1 className="page__title">Sites</h1>
        <p className="page__subtitle">
          {sites.length === 0
            ? 'No sites in this workspace yet.'
            : `${String(sites.length)} site${sites.length === 1 ? '' : 's'} in your workspace.`}
        </p>
      </header>

      {sites.length === 0 ? (
        <p className="dash__empty">
          A site appears here when it is created in the database. Until then the widget has nothing
          to connect with.
        </p>
      ) : (
        <ul className="cards">
          {sites.map((site) => (
            <li className="card" key={site.id}>
              <Link className="card__link" href={`/dashboard/sites/${site.id}`}>
                {site.name}
              </Link>
              <p className="card__row">
                <span className="card__label">Key</span>
                <code className="card__code">{site.publicKey}</code>
              </p>
              <p className="card__row">
                <span className="card__label">Assistant</span>
                {site.aiConfig === null ? (
                  <span className="card__muted">not configured yet</span>
                ) : (
                  <span>{site.aiConfig.model}</span>
                )}
              </p>
              <p className="card__row">
                <span className="card__label">Origins</span>
                <span>{site.allowedOrigins.length}</span>
              </p>
              <p className="card__row">
                <span className="card__label">Widget</span>
                {site.widgetTitle === null && site.widgetColor === null ? (
                  <span className="card__muted">default appearance</span>
                ) : (
                  <span>
                    {site.widgetTitle ?? 'default title'}
                    {site.widgetColor === null ? '' : ` · ${site.widgetColor}`}
                  </span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
