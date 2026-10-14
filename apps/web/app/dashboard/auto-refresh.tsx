'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Обновляет данные страницы сама, без перезагрузки.
 *
 * Оператор не должен нажимать F5, чтобы увидеть новый разговор: очередь, которая
 * не обновляется, — это список на момент открытия, а не очередь. Здесь
 * перерисовываются только серверные компоненты, поэтому состояние формы ввода и
 * позиция прокрутки не теряются.
 *
 * Свёрнутая вкладка не обновляется: оператор может держать панель открытой весь
 * день в фоне, и запрашивать данные для невидимой страницы незачем. При
 * возвращении к вкладке обновление происходит сразу, а не через интервал.
 */
export function AutoRefresh({ seconds = 5 }: { seconds?: number }) {
  const router = useRouter();

  useEffect(() => {
    function refreshNow(): void {
      if (document.visibilityState === 'visible') router.refresh();
    }

    const timer = window.setInterval(refreshNow, seconds * 1000);
    // Возвращение к вкладке — самый вероятный момент, когда данные устарели.
    document.addEventListener('visibilitychange', refreshNow);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshNow);
    };
  }, [router, seconds]);

  return null;
}
