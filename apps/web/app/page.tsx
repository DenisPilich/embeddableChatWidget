import type { Metadata } from 'next';
import './theme.css';

/**
 * Корневая страница приложения.
 *
 * Когда-то это была заглушка «здесь когда-нибудь появится дашборд». Теперь она
 * нужна для другого: объяснить за одну секунду, что здесь есть, и дать две
 * ссылки — на демонстрацию и на панель оператора. Искать `/demo` в адресной
 * строке никто не обязан.
 *
 * Оформлена тем же набором правил, что и демонстрационная страница (theme.css),
 * иначе двери проекта выглядели бы как два разных сайта.
 */
export const metadata: Metadata = {
  title: 'Embeddable Chat Widget',
};

export default function HomePage() {
  return (
    <main className="stage">
      <div aria-hidden className="stage__glow" />
      <div aria-hidden className="stage__dust" />

      <div className="stage__inner">
        <header className="bar">
          <span className="bar__brand">Embeddable Chat Widget</span>
          <nav className="bar__nav">
            <a className="bar__link" href="/demo">
              Demo page
            </a>
            <a className="bar__link" href="/dashboard">
              Dashboard
            </a>
            <a className="bar__link" href="/api/health">
              Health
            </a>
          </nav>
          <a className="bar__cta" href="/demo">
            Open the demo
          </a>
        </header>

        <section className="hero">
          <div>
            <p className="kicker">Backend · operator dashboard</p>

            <h1 className="hero__title">
              The other side of
              <span className="hero__accent"> the widget</span>
            </h1>

            <p className="hero__lead">
              This application serves the widget&apos;s API: it keeps the conversations, asks the
              model, streams the answer back, and hands the visitor to a human when they ask for
              one. The widget itself lives in <code>packages/widget</code> and is published to npm —
              it arrives on a customer&apos;s page as a single script tag.
            </p>

            <div className="hero__actions">
              <a className="cta" href="/demo">
                Open the demo page
              </a>
              <a className="ghost" href="/dashboard">
                Operator dashboard
              </a>
            </div>

            <ul className="chips">
              <li className="chip">
                <span className="chip__dot" />
                Widget published on npm
              </li>
              <li className="chip">Answers stream live</li>
              <li className="chip">Hands over to a human</li>
            </ul>
          </div>

          <aside className="latest">
            <p className="kicker">Demo instance</p>
            <h2 className="latest__title">Operator sign in</h2>
            <p className="latest__text">
              The seed creates one operator for this demo. Everything it can see is a fictional
              coffee shop — a real site belongs in its own workspace with its own password.
            </p>
            <p className="latest__text">
              <code>demo@example.com</code>
              <br />
              <code>demo-operator-2026</code>
            </p>
            <a className="ghost ghost--small" href="/dashboard">
              Sign in
            </a>
          </aside>
        </section>

        <section className="panel">
          <h2 className="panel__title">Health</h2>
          <ul className="links">
            <li className="links__item">
              <a href="/api/health">/api/health</a>— the application answers at all
            </li>
            <li className="links__item">
              <a href="/api/health/db">/api/health/db</a>— the database is reachable
            </li>
            <li className="links__item">
              <a href="/api/health/ai">/api/health/ai</a>— which model is configured; add{' '}
              <code>?check=1</code> to actually call it
            </li>
          </ul>
        </section>

        <p className="foot">
          What this project does, how to run it and why it is built this way — in the repository
          README.
        </p>
      </div>
    </main>
  );
}
