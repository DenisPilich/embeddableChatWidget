/**
 * Ограничение частоты обращений.
 *
 * Считаем по данным, которые уже есть в базе, а не заводим счётчики в памяти:
 * серверные функции не хранят состояние между вызовами, и счётчик в памяти
 * обнулялся бы на каждом запросе. Счёт по строкам за окно времени работает без
 * внешнего хранилища и без новых таблиц — ценой одного запроса к базе.
 *
 * IP-адреса намеренно не храним: посетитель виджета — не наш пользователь, и
 * собирать его адрес ради защиты от спама значило бы собирать персональные
 * данные там, где можно обойтись без них. Поэтому пределы — на диалог и на сайт.
 *
 * Значения читаются при каждом обращении, а не при загрузке модуля: тогда их
 * можно задать окружением и проверить в автотестах, не пересобирая проект.
 */

/** Сколько сообщений посетителя принимаем в одном диалоге за минуту. */
export function messagesPerMinute(): number {
  return readLimit('ECW_LIMIT_MESSAGES_PER_MINUTE', 20);
}

/** Сколько новых посетителей принимаем на сайт за час. */
export function newVisitorsPerHour(): number {
  return readLimit('ECW_LIMIT_VISITORS_PER_HOUR', 60);
}

function readLimit(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw === '') return fallback;

  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function minuteAgo(now: Date = new Date()): Date {
  return new Date(now.getTime() - 60_000);
}

export function hourAgo(now: Date = new Date()): Date {
  return new Date(now.getTime() - 3_600_000);
}
