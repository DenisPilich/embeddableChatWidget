/** Пауза на указанное число миллисекунд. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Уникальный идентификатор сообщения.
 *
 * `crypto.randomUUID` существует только в защищённом контексте — на https или
 * localhost. На http-странице его нет, а падать из-за этого виджет не имеет
 * права, поэтому есть запасной путь. В Фазе 2 настоящий идентификатор будет
 * приходить с сервера, и этот помощник понадобится только для оптимистичных
 * (ещё не подтверждённых) сообщений.
 */
export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
