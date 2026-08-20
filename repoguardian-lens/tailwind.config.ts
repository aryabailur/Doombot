import type { Config } from 'tailwindcss'

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        lens: {
          canvas: 'var(--lens-canvas)',
          surface: 'var(--lens-surface)',
          raised: 'var(--lens-raised)',
          elevated: 'var(--lens-elevated)',
          border: 'var(--lens-border)',
          primary: 'var(--lens-primary)',
          live: 'var(--lens-live)',
          success: 'var(--lens-success)',
          warning: 'var(--lens-warning)',
          danger: 'var(--lens-danger)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config
