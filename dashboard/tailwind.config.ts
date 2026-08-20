import type { Config } from 'tailwindcss'

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        destructive: 'var(--destructive)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        surface: {
          1: 'var(--surface-1)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)',
        },
        border: 'var(--border)',
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          bright: 'var(--accent-bright)',
          muted: 'var(--accent-muted)',
        },
        critical: 'var(--critical)',
        high: 'var(--high)',
        warning: 'var(--warning)',
        information: 'var(--information)',
        success: 'var(--success)',
        neutral: 'var(--neutral)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      maxWidth: {
        content: '1440px',
      },
      zIndex: {
        base: 'var(--z-base)',
        sticky: 'var(--z-sticky)',
        dropdown: 'var(--z-dropdown)',
        overlay: 'var(--z-overlay)',
        modal: 'var(--z-modal)',
        popover: 'var(--z-popover)',
        toast: 'var(--z-toast)',
      },
    },
  },
  plugins: [],
} satisfies Config
