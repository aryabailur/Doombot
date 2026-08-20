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
        // mayank's names, so a component ported from that branch styles
        // correctly without a rename pass.
        ink: 'var(--text-primary)',
        info: 'var(--info)',
        danger: 'var(--danger)',
        security: 'var(--security)',
        mint: 'var(--mint)',
        lilac: 'var(--lilac)',
        // The soft companion fills. In the light theme these are pastels; here
        // they are alpha tints, which is why they are separate tokens rather
        // than `bg-accent/14` -- the opacity belongs to the palette, not the
        // call site, so every badge in the app agrees on it.
        'accent-soft': 'var(--accent-soft)',
        'info-soft': 'var(--info-soft)',
        'success-soft': 'var(--success-soft)',
        'warning-soft': 'var(--warning-soft)',
        'danger-soft': 'var(--danger-soft)',
        'security-soft': 'var(--security-soft)',
      },
      boxShadow: {
        // The flat offset shadows this design system is built on. Referenced in
        // ten places before this and defined in none of them, so every
        // `shadow-brutal` in the dashboard was a no-op.
        brutal: 'var(--shadow-flat)',
        'brutal-sm': 'var(--shadow-flat-sm)',
        'brutal-lg': 'var(--shadow-flat-lg)',
        raised: 'var(--shadow-raised)',
        overlay: 'var(--shadow-overlay)',
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
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
