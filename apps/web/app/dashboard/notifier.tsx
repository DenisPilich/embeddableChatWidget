'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Извещение о новом разговоре, который ждёт человека.
 *
 * Раньше о новом разговоре можно было узнать, только открыв панель. Оператор
 * держит её в фоне, и этого мало: разговор ждёт, пока никто не смотрит.
 *
 * Работает на любой странице панели и берёт число отдельным запросом, а не из
 * данных страницы: чаще всего оператор сидит в переписке, а не в очереди.
 *
 * Чего здесь нет и почему: извещения при закрытой вкладке. Для них нужен либо
 * почтовый сервис с ключом, либо push-подписка с VAPID — и то и другое тянет
 * чужую зависимость и настройку. Пока вкладка открыта (пусть и не в фокусе),
 * уведомление доходит — это и есть рабочий случай.
 */

/** Как часто спрашиваем число ожидающих. */
const POLL_SECONDS = 10;

export function Notifier() {
  const previous = useRef<number | null>(null);

  useEffect(() => {
    let stopped = false;

    async function check(): Promise<void> {
      try {
        const response = await fetch('/api/operator/waiting', { cache: 'no-store' });
        if (!response.ok) return;

        const body = (await response.json()) as { waiting?: unknown };
        const waiting = typeof body.waiting === 'number' ? body.waiting : 0;

        // Первый ответ — не новость: столько ждало и до нас.
        if (previous.current === null) {
          previous.current = waiting;
          return;
        }

        const grew = waiting > previous.current;
        previous.current = waiting;
        if (!grew || stopped) return;

        beep();
        // Всплывающее уведомление — только когда вкладка не видна: если оператор
        // смотрит на панель, он и так всё видит.
        if (document.visibilityState !== 'visible') notify(waiting);
      } catch {
        // Сеть отвалилась — молчим: следующая попытка через десять секунд.
      }
    }

    void check();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') void check();
    }, POLL_SECONDS * 1000);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  return null;
}

/**
 * Кнопка разрешения уведомлений.
 *
 * Показывается, пока браузер не спросил. Спрашивать разрешение без действия
 * человека нельзя: браузеры это запрещают, и правильно делают.
 */
export function NotifyToggle() {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');

  useEffect(() => {
    setPermission(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  }, []);

  if (permission !== 'default') return null;

  return (
    <button
      className="shell__link shell__link--button"
      onClick={() => {
        void Notification.requestPermission().then((result) => {
          setPermission(result);
        });
      }}
      type="button"
    >
      Enable alerts
    </button>
  );
}

/** Короткий сигнал: оператор может быть в другой вкладке и не смотреть на экран. */
function beep(): void {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.frequency.value = 660;
    // Тихо: это подсказка, а не пожарная тревога.
    gain.gain.value = 0.06;
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.18);

    window.setTimeout(() => {
      void context.close();
    }, 400);
  } catch {
    // Звук может быть недоступен — уведомление всё равно покажем.
  }
}

function notify(waiting: number): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

  try {
    new Notification('A conversation is waiting', {
      body: `${String(waiting)} waiting for a human. Open the dashboard to answer.`,
      tag: 'ecw-waiting',
    });
  } catch {
    // Некоторые браузеры запрещают уведомления из фоновой вкладки — не беда.
  }
}
