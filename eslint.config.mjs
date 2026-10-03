// ESLint 10, «плоская» конфигурация (flat config).
// Она одна на весь монорепо: ESLint сам обходит пакеты, и ни один пакет не
// тащит собственную копию правил, которая со временем разъедется с остальными.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    // Собранные файлы проверять бессмысленно: это результат работы сборщика,
    // а не код, который кто-то написал руками.
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.d.ts'],
  },

  // Базовые правила JavaScript. Действуют и на сам этот файл.
  js.configs.recommended,

  {
    files: ['**/*.ts'],
    // recommendedTypeChecked — правила, которым нужна информация о типах.
    // Именно они ловят самое ценное: забытый await, необработанный Promise,
    // сравнение заведомо несовместимых типов.
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        // projectService сам находит ближайший tsconfig.json для каждого файла.
        // Без этого пришлось бы перечислять пути ко всем tsconfig руками —
        // и забывать их обновлять при добавлении пакета.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // TypeScript и так сообщает о неизвестных именах — причём знает про DOM,
      // window, document и fetch, а ESLint нет. Дублировать эту проверку вредно:
      // получаются ложные срабатывания на совершенно правильном коде.
      'no-undef': 'off',

      // Строгое сравнение. Оператор == приводит типы и прощает опечатки:
      // '0' == 0 истинно, null == undefined истинно. Это источник ошибок,
      // которые не видны глазом.
      eqeqeq: ['error', 'always'],

      // При включённом verbatimModuleSyntax типы надо импортировать через
      // import type. Если этого не делать, импорт типа попадёт в итоговый бандл
      // как обычный импорт — то есть в коде клиента окажется лишняя строка,
      // а иногда и ошибка времени выполнения.
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],

      // any выключает проверку типов ровно там, где она нужнее всего.
      // Если очень нужно — пусть будет явный eslint-disable с объяснением.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  {
    // Виджет живёт на чужой странице, и каждое наше сообщение в консоли — это
    // мусор в консоли клиента. warn и error разрешены: это сигнал о нашей
    // проблеме, и его полезно увидеть. log, info и debug запрещены.
    files: ['packages/widget/src/**/*.ts'],
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  // Отключает правила оформления, которые конфликтуют с Prettier.
  // Обязательно последним: иначе порядок конфигураций сделает своё дело
  // и спорное правило вернётся.
  prettier,
);
