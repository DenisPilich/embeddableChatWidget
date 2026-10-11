import type { Metadata } from 'next';
import { findFirstSite } from '@/lib/data';
import './demo.css';

/**
 * Демонстрационная страница: тот же вымышленный сайт кофейни, что и на стендах,
 * но внутри приложения.
 *
 * Нужна для развёрнутого варианта: посетителю достаточно одной ссылки, и на одном
 * адресе оказывается всё — страница клиента, виджет, API, база и панель
 * оператора. Отдельный хостинг для «сайта клиента» при этом не нужен.
 *
 * Виджет подключается с собственного адреса приложения (`/ecw/`), а не с CDN:
 * так демонстрация показывает ровно тот код, что лежит в репозитории, и не
 * зависит от того, выпущена ли новая версия пакета. Путь клиента — CDN — описан
 * в README и проверяется отдельным тестом.
 *
 * Адрес API — `/`, то есть тот же домен. Поэтому страница работает и на
 * localhost, и на боевом адресе без правок: в этом и смысл относительного пути.
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
      <main className="shop">
        <header>
          <h1>Little Cloud Coffee</h1>
          <p className="shop__tagline">Roasted on Tuesdays, baked every day</p>
        </header>

        <section className="shop__try" aria-labelledby="try-title">
          <h2 id="try-title">Try the chat widget</h2>
          <ol>
            <li>Ask the assistant in the corner something — for example about opening hours.</li>
            <li>
              Press <strong>Talk to a human</strong> when you want an operator instead of the
              assistant.
            </li>
            <li>
              Open <a href="/dashboard">the operator dashboard</a> and sign in as{' '}
              <code>demo@example.com</code> / <code>demo-operator-2026</code>. The conversation is
              waiting in the queue, and an answer written there appears in the widget.
            </li>
          </ol>
          <p className="shop__note">
            Answers come from a real model, and the free plan allows about twenty questions a day.
            The widget keeps the conversation in the browser, so it survives a page reload.
          </p>
        </section>

        <p>
          We are a small coffee shop on the corner of Vinogradnaya and Pekarskiy. Open since 2014,
          we roast our own beans and serve nothing we would not drink ourselves.
        </p>

        <h2>Opening hours</h2>
        <table className="shop__hours">
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

        <h2>How to find us</h2>
        <p>
          Vinogradnaya 14, the entrance is from the courtyard. If you see a queue outside, it moves
          faster than it looks.
        </p>

        <footer>
          <p>
            © Little Cloud Coffee. The shop is fictional: this page demonstrates an embeddable chat
            widget.
          </p>
        </footer>
      </main>

      {site === null ? (
        // Пустой страницы быть не должно: без ключа сайта виджет не запустится, и
        // человек не поймёт, что случилось.
        <p className="shop__error" role="alert">
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
