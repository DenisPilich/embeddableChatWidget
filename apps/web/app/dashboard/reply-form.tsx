'use client';

import { useEffect, useRef } from 'react';

/**
 * Форма ответа с отправкой по Ctrl+Enter.
 *
 * Обычная кнопка остаётся: сочетание клавиш — ускорение для тех, кто им
 * пользуется, а не единственный способ отправить. Оператор отвечает десятками
 * сообщений в день, и каждый раз тянуться мышью к кнопке — это то, из-за чего
 * инструмент начинают не любить.
 *
 * Enter без Ctrl оставлен как перенос строки: ответы оператора часто состоят из
 * нескольких абзацев, и отправлять их по случайному нажатию нельзя.
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
      const isSubmit = (event.ctrlKey || event.metaKey) && event.key === 'Enter';
      if (!isSubmit) return;

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
