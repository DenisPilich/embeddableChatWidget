/**
 * Главная страница серверной части.
 *
 * Её задача — не рассказывать о проекте (для этого есть README и лендинг из
 * Фазы 7), а быть точкой входа: показать, что приложение поднялось, и дать
 * ссылки на то, что здесь действительно можно открыть.
 */
export default function HomePage() {
  return (
    <main
      style={{
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        lineHeight: 1.6,
        maxWidth: '40rem',
        margin: '0 auto',
        padding: '3rem 1.5rem',
        color: '#0f172a',
      }}
    >
      <h1 style={{ marginBottom: '0.5rem' }}>Embeddable Chat Widget</h1>
      <p style={{ marginTop: 0, color: '#475569' }}>
        Backend of the project. The widget itself lives in <code>packages/widget</code> and is
        published to npm; this application serves its API and the operator dashboard.
      </p>

      <h2 style={{ fontSize: '1rem', marginTop: '2rem' }}>Operator dashboard</h2>
      <p style={{ marginTop: 0 }}>
        <a href="/dashboard">/dashboard</a> — the conversation queue, replies and site settings. It
        asks you to sign in first. This is a demo instance, so the seed creates an operator for it:
      </p>
      <p style={{ marginTop: 0, padding: '0.75rem 1rem', background: '#f1f5f9', borderRadius: 8 }}>
        <code>demo@example.com</code> · <code>demo-operator-2026</code>
      </p>

      <h2 style={{ fontSize: '1rem', marginTop: '2rem' }}>Health</h2>
      <ul style={{ marginTop: 0, paddingLeft: '1.25rem' }}>
        <li>
          <a href="/api/health">/api/health</a> — the application answers at all
        </li>
        <li>
          <a href="/api/health/db">/api/health/db</a> — the database is reachable
        </li>
        <li>
          <a href="/api/health/ai">/api/health/ai</a> — which model is configured; add{' '}
          <code>?check=1</code> to actually call it
        </li>
      </ul>

      <p style={{ marginTop: '2rem', color: '#475569', fontSize: '0.9rem' }}>
        What this project does, how to run it and why it is built this way — in the repository
        README.
      </p>
    </main>
  );
}
