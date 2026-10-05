import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Пакеты рабочей области не публикуются в npm и отдаются исходным кодом на
  // TypeScript. Next.js по умолчанию не компилирует чужой код из node_modules,
  // поэтому пакет надо назвать явно.
  transpilePackages: ['@ecw/shared'],
};

export default nextConfig;
