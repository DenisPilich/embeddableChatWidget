/** Время в виде, пригодном для чтения: «12.10, 14:32». */
export function formatMoment(value: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    // Часовой пояс сервера: оператор и сервер в одном поясе, а показывать
    // посетителю время мы не обещали.
  }).format(value);
}

/** Сколько времени прошло: «5 min», «3 h», «2 d». */
export function formatWaiting(value: Date, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - value.getTime()) / 60_000));
  if (minutes < 60) return `${String(minutes)} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)} h`;

  return `${String(Math.round(hours / 24))} d`;
}
