'use client';

import { useEffect, useRef } from 'react';

/**
 * Форма ответа с отправкой по Enter.
 *
 * Оператор отвечает десятками сообщений в день, и каждый раз тянуться мышью к
 * кнопке — это то, из-за чего инструмент начинают не любить. Enter отправляет,
 * Shift+Enter переносит строку: так же, как в самом виджете, чтобы обе стороны
 * разговора вели себя одинаково.
 *
 * Раньше отправлял только Ctrl+Enter, а Enter переносил строку. На практике
 * оказалось наоборот: операторы жмут Enter и удивляются, что ничего не уходит,
 * а многоабзацные ответы пишут редко. Ctrl+Enter оставлен работающим — привычка
 * у тех, кто им уже пользуется.
 *
 * Отправка — только из поля ввода: Enter на кнопке или в ссылке страницы
 * отправлять не должен.
 */
export function ReplyForm({
  action,
  children,
}: {
  action: (form: FormData) => void | Promise<void>;
  children: React.ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const form = formRef.current;
    if (form === null) return;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Enter') return;

      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement)) return;

      // Shift+Enter — перенос строки; Ctrl и Cmd оставлены для привычки.
      if (event.shiftKey) return;

      event.preventDefault();
      // requestSubmit, а не submit: так срабатывают проверки полей и остаётся
      // поведение обычной кнопки.
      form?.requestSubmit();
    }

    form.addEventListener('keydown', onKeyDown);
    return () => {
      form.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <form action={action} className="reply" ref={formRef}>
      {children}
    </form>
  );
}
