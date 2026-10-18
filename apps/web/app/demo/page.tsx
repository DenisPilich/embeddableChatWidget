import type { Metadata } from 'next';
import { findFirstSite } from '@/lib/data';
import { OpenChatButton } from './open-chat-button';
import '../theme.css';
import './demo.css';

/**
 * Демонстрационная страница: вымышленный сайт кофейни, на который поставлен
 * виджет.
 *
 * Оформлена намеренно «богато» — тёмный фон, свечение, крупный заголовок. Это не
 * украшательство ради красоты: страница показывает главное свойство проекта —
 * виджет живёт на ЧУЖОЙ странице, к её оформлению отношения не имеет и ничего в
 * ней не ломает. Стили страницы и стили виджета не пересекаются, а вес страницы
 * на вес виджета не влияет: виджет остаётся одной строкой и десяти килобайтами.
 *
 * Ключ сайта подставляется на лету (см. live-stand.ts): он случаен и создаётся
 * при наполнении базы. Адрес API относительный, поэтому страница работает и на
 * localhost, и на боевом домене без правок.
 */
export const metadata: Metadata = {
  title: 'Little Cloud Coffee — chat widget demo',
};

// Ключ сайта лежит в базе, поэтому страница собирается на каждый запрос.
export const dynamic = 'force-dynamic';

export default async function DemoPage() {
  const site = await findFirstSite();

  return (
    <>
      <main className="stage">
        {/* Свет и пыль — чистый CSS, ни одной картинки: страница не должна
            тянуть мегабайты ради настроения. */}
        <div aria-hidden className="stage__glow" />
        <div aria-hidden className="stage__dust" />

        <div className="stage__inner">
          <header className="bar">
            <span className="bar__brand">Little Cloud</span>
            <nav className="bar__nav">
              <a className="bar__link" href="#hours">
                Hours
              </a>
              <a className="bar__link" href="#try">
                How it works
              </a>
              <a className="bar__link" href="/dashboard">
                Dashboard
              </a>
            </nav>
            <OpenChatButton className="bar__cta">Write to us</OpenChatButton>
          </header>

          <section className="hero">
            <div className="hero__main">
              <p className="kicker">Specialty coffee · since 2014</p>

              <h1 className="hero__title">
                Little Cloud Coffee —<span className="hero__accent"> roasted on Tuesdays</span>
              </h1>

              <p className="hero__lead">
                A small shop on the corner of Vinogradnaya and Pekarskiy. We roast our own beans,
                bake every morning, and serve nothing we would not drink ourselves.
              </p>

              <div className="hero__actions">
                <OpenChatButton className="cta">Ask the assistant</OpenChatButton>
                <a className="ghost" href="#hours">
                  Opening hours
                </a>
              </div>

              <ul className="chips">
                <li className="chip">
                  <span className="chip__dot" />
                  Open until 21:00
                </li>
                <li className="chip">Own roast, weekly</li>
                <li className="chip">Vinogradnaya 14</li>
              </ul>
            </div>

            <aside className="latest">
              <p className="kicker">Latest</p>
              <h2 className="latest__title">Autumn blend 2026</h2>
              <p className="latest__text">
                Cocoa, baked apple and a long finish. On the shelf from Tuesday, in cups for as long
                as we can keep it — last year it ran out in three weeks.
              </p>
              <a className="ghost ghost--small" href="#try">
                Read more
              </a>
            </aside>
          </section>

          <section className="panel" id="try">
            <h2 className="panel__title">This page has a chat widget on it</h2>
            <p className="panel__note">
              It is a separate file served from its own address, isolated in a Shadow DOM. Nothing
              on this page styles it, and it styles nothing here.
            </p>

            <ol className="steps">
              <li className="steps__item">
                <span className="steps__number">1</span>
                <span>
                  Press <strong>Write to us</strong> or the bubble in the corner, and ask about
                  opening hours.
                </span>
              </li>
              <li className="steps__item">
                <span className="steps__number">2</span>
                <span>
                  Press <strong>Talk to a human</strong> in the chat window when you want an
                  operator instead of the assistant.
                </span>
              </li>
              <li className="steps__item">
                <span className="steps__number">3</span>
                <span>
                  Open <a href="/dashboard">the operator dashboard</a> — sign in as{' '}
                  <code>demo@example.com</code> / <code>demo-operator-2026</code>. The conversation
                  waits in the queue, and an answer written there appears in the chat.
                </span>
              </li>
            </ol>

            <p className="panel__note">
              Answers come from a real model, and the free plan allows about twenty questions a day.
              The conversation is kept in the browser, so it survives a reload.
            </p>
          </section>

          <section className="panel panel--split" id="hours">
            <div>
              <h2 className="panel__title">Opening hours</h2>
              <table className="hours">
                <tbody>
                  <tr>
                    <th>Monday — Friday</th>
                    <td>08:00 — 21:00</td>
                  </tr>
                  <tr>
                    <th>Saturday</th>
                    <td>09:00 — 22:00</td>
                  </tr>
                  <tr>
                    <th>Sunday</th>
                    <td>09:00 — 19:00</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div>
              <h2 className="panel__title">How to find us</h2>
              <p className="panel__note">
                Vinogradnaya 14, the entrance is from the courtyard. If you see a queue outside, it
                moves faster than it looks.
              </p>
            </div>
          </section>

          <footer className="foot">
            © Little Cloud Coffee. The shop is fictional: this page demonstrates an embeddable chat
            widget.
          </footer>
        </div>
      </main>

      {site === null ? (
        // Пустой страницы быть не должно: без ключа сайта виджет не запустится, и
        // человек не поймёт, что случилось.
        <p className="stage__error" role="alert">
          The database has no sites yet, so the widget has nothing to connect with. Run{' '}
          <code>pnpm db:seed</code> and reload.
        </p>
      ) : (
        // Ровно такая вставка достаётся клиенту: одна строка и свой ключ сайта.
        <script
          src="/ecw/ecw-loader.iife.js"
          data-site-id={site.publicKey}
          data-ecw-api="/"
          async
        />
      )}
    </>
  );
}
