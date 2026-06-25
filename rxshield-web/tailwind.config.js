/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx}",
    "./src/components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'app-base': '#F8F9FA',
        'surface-card': '#FFFFFF',
        'structural-weak': '#E2E8F0',
        'clinical-primary': '#0F172A',
        'clinical-muted': '#475569',
        'brand-pass-solid': '#16A34A',
        'brand-pass-text': '#FFFFFF',
        'brand-conditional-bg': '#F59E0B',
        'brand-conditional-text': '#000000',
        'brand-danger-solid': '#BE123C',
        'brand-danger-text': '#FFFFFF',
        'accent-ai-pipeline': '#2563EB',
        'accent-ai-pulse': '#DBEAFE',
        'trust-teal': '#008080',
        'trust-teal-hover': '#006666',
        'alert-amber': '#FFBF00',
        'alert-red': '#DC3545',
      },
      borderRadius: {
        'none': '0px',
        'sharp': '2px',
        'interactive': '6px',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-mono', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
