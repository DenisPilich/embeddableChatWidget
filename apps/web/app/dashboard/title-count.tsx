'use client';

import { useEffect } from 'react';

/**
 * Показывает число ожидающих в заголовке вкладки.
 *
 * Оператор держит панель в фоне, и заголовок вкладки — единственное место,
 * которое видно, когда окно не в фокусе. Без этого о новом разговоре узнать
 * неоткуда: почты и звука у нас нет.
 */
export function TitleCount({ waiting }: { waiting: number }) {
  useEffect(() => {
    const previous = document.title;
    document.title = waiting > 0 ? `(${String(waiting)}) Conversations` : 'Conversations';

    return () => {
      document.title = previous;
    };
  }, [waiting]);

  return null;
}
