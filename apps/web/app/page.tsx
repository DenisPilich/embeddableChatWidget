/**
 * Временная главная страница серверной части.
 *
 * Здесь же в Фазе 5 появится дашборд оператора, а в Фазе 7 — лендинг проекта.
 * Пока страница нужна только для того, чтобы у приложения была точка входа и
 * было видно, что оно поднимается.
 */
export default function HomePage() {
  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        lineHeight: 1.5,
        maxWidth: '40rem',
        margin: '0 auto',
        padding: '3rem 1.5rem',
      }}
    >
      <h1>Embeddable Chat Widget</h1>
      <p>
        Это серверная часть проекта. Сам виджет живёт в <code>packages/widget</code>, дашборд
        оператора появится здесь же в Фазе 5.
      </p>
      <p>
        Проверка работоспособности: <a href="/api/health">/api/health</a>
      </p>
    </main>
  );
}
