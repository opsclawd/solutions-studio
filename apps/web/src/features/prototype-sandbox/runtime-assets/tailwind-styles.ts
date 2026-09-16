/**
 * Inlined Tailwind utility CSS for the isolated Prototype Sandbox.
 *
 * Provides a self-contained, air-gapped utility stylesheet conforming to
 * CSP connect-src 'none' and style-src 'unsafe-inline'.
 */

export const TAILWIND_SANDBOX_CSS = `
*, ::before, ::after {
  box-sizing: border-box;
  border-width: 0;
  border-style: solid;
  border-color: #e5e7eb;
}
html, body {
  margin: 0;
  padding: 0;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  line-height: 1.5;
  color: #111827;
  background-color: transparent;
}
button, input, optgroup, select, textarea {
  font-family: inherit;
  font-size: 100%;
  line-height: inherit;
  margin: 0;
  padding: 0;
}
button {
  cursor: pointer;
  background-color: transparent;
  background-image: none;
}
/* Layout */
.flex { display: flex; }
.inline-flex { display: inline-flex; }
.grid { display: grid; }
.hidden { display: none; }
.block { display: block; }
.inline-block { display: inline-block; }
.flex-col { flex-direction: column; }
.flex-row { flex-direction: row; }
.flex-1 { flex: 1 1 0%; }
.flex-wrap { flex-wrap: wrap; }
.items-center { align-items: center; }
.items-start { align-items: flex-start; }
.items-end { align-items: flex-end; }
.justify-center { justify-content: center; }
.justify-between { justify-content: space-between; }
.justify-start { justify-content: flex-start; }
.justify-end { justify-content: flex-end; }
.grid-cols-1 { grid-template-columns: repeat(1, minmax(0, 1fr)); }
.grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }

/* Gaps */
.gap-1 { gap: 0.25rem; }
.gap-2 { gap: 0.5rem; }
.gap-3 { gap: 0.75rem; }
.gap-4 { gap: 1rem; }
.gap-6 { gap: 1.5rem; }
.gap-8 { gap: 2rem; }
.space-y-1 > :not([hidden]) ~ :not([hidden]) { margin-top: 0.25rem; }
.space-y-2 > :not([hidden]) ~ :not([hidden]) { margin-top: 0.5rem; }
.space-y-3 > :not([hidden]) ~ :not([hidden]) { margin-top: 0.75rem; }
.space-y-4 > :not([hidden]) ~ :not([hidden]) { margin-top: 1rem; }
.space-y-6 > :not([hidden]) ~ :not([hidden]) { margin-top: 1.5rem; }

/* Sizing */
.w-full { width: 100%; }
.w-auto { width: auto; }
.w-64 { width: 16rem; }
.h-full { height: 100%; }
.min-h-screen { min-height: 100vh; }
.max-w-xs { max-width: 20rem; }
.max-w-sm { max-width: 24rem; }
.max-w-md { max-width: 28rem; }
.max-w-lg { max-width: 32rem; }
.max-w-xl { max-width: 36rem; }
.max-w-2xl { max-width: 42rem; }

/* Spacing */
.p-1 { padding: 0.25rem; }
.p-2 { padding: 0.5rem; }
.p-3 { padding: 0.75rem; }
.p-4 { padding: 1rem; }
.p-6 { padding: 1.5rem; }
.p-8 { padding: 2rem; }
.px-2 { padding-left: 0.5rem; padding-right: 0.5rem; }
.px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }
.px-4 { padding-left: 1rem; padding-right: 1rem; }
.px-6 { padding-left: 1.5rem; padding-right: 1.5rem; }
.py-1 { padding-top: 0.25rem; padding-bottom: 0.25rem; }
.py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
.py-3 { padding-top: 0.75rem; padding-bottom: 0.75rem; }
.py-4 { padding-top: 1rem; padding-bottom: 1rem; }
.m-1 { margin: 0.25rem; }
.m-2 { margin: 0.5rem; }
.m-4 { margin: 1rem; }
.mx-auto { margin-left: auto; margin-right: auto; }
.mt-1 { margin-top: 0.25rem; }
.mt-2 { margin-top: 0.5rem; }
.mt-3 { margin-top: 0.75rem; }
.mt-4 { margin-top: 1rem; }
.mt-6 { margin-top: 1.5rem; }
.mb-1 { margin-bottom: 0.25rem; }
.mb-2 { margin-bottom: 0.5rem; }
.mb-3 { margin-bottom: 0.75rem; }
.mb-4 { margin-bottom: 1rem; }
.mb-6 { margin-bottom: 1.5rem; }

/* Typography */
.text-xs { font-size: 0.75rem; line-height: 1rem; }
.text-sm { font-size: 0.875rem; line-height: 1.25rem; }
.text-base { font-size: 1rem; line-height: 1.5rem; }
.text-lg { font-size: 1.125rem; line-height: 1.75rem; }
.text-xl { font-size: 1.25rem; line-height: 1.75rem; }
.text-2xl { font-size: 1.5rem; line-height: 2rem; }
.text-3xl { font-size: 1.875rem; line-height: 2.25rem; }
.font-normal { font-weight: 400; }
.font-medium { font-weight: 500; }
.font-semibold { font-weight: 600; }
.font-bold { font-weight: 700; }
.text-center { text-align: center; }
.text-left { text-align: left; }
.text-right { text-align: right; }
.uppercase { text-transform: uppercase; }
.tracking-wide { letter-spacing: 0.025em; }

/* Colors - Background */
.bg-white { background-color: #ffffff; }
.bg-gray-50 { background-color: #f9fafb; }
.bg-gray-100 { background-color: #f3f4f6; }
.bg-gray-200 { background-color: #e5e7eb; }
.bg-gray-800 { background-color: #1f2937; }
.bg-gray-900 { background-color: #111827; }
.bg-blue-50 { background-color: #eff6ff; }
.bg-blue-100 { background-color: #dbeafe; }
.bg-blue-500 { background-color: #3b82f6; }
.bg-blue-600 { background-color: #2563eb; }
.bg-blue-700 { background-color: #1d4ed8; }
.bg-red-50 { background-color: #fef2f2; }
.bg-red-100 { background-color: #fee2e2; }
.bg-red-500 { background-color: #ef4444; }
.bg-red-600 { background-color: #dc2626; }
.bg-green-50 { background-color: #f0fdf4; }
.bg-green-100 { background-color: #dcfce7; }
.bg-green-500 { background-color: #22c55e; }
.bg-green-600 { background-color: #16a34a; }
.bg-yellow-50 { background-color: #fefce8; }
.bg-yellow-100 { background-color: #fef9c3; }
.bg-yellow-500 { background-color: #eab308; }

/* Colors - Text */
.text-white { color: #ffffff; }
.text-gray-400 { color: #9ca3af; }
.text-gray-500 { color: #6b7280; }
.text-gray-600 { color: #4b5563; }
.text-gray-700 { color: #374151; }
.text-gray-800 { color: #1f2937; }
.text-gray-900 { color: #111827; }
.text-blue-600 { color: #2563eb; }
.text-blue-700 { color: #1d4ed8; }
.text-red-600 { color: #dc2626; }
.text-red-700 { color: #b91c1c; }
.text-green-600 { color: #16a34a; }
.text-green-700 { color: #15803d; }
.text-yellow-700 { color: #a16207; }
.text-yellow-800 { color: #854d0e; }

/* Borders & Rounded */
.border { border-width: 1px; }
.border-2 { border-width: 2px; }
.border-transparent { border-color: transparent; }
.border-gray-200 { border-color: #e5e7eb; }
.border-gray-300 { border-color: #d1d5db; }
.border-blue-500 { border-color: #3b82f6; }
.border-red-300 { border-color: #fca5a5; }
.border-red-500 { border-color: #ef4444; }
.border-green-300 { border-color: #86efac; }
.border-green-500 { border-color: #22c55e; }
.rounded { border-radius: 0.25rem; }
.rounded-md { border-radius: 0.375rem; }
.rounded-lg { border-radius: 0.5rem; }
.rounded-xl { border-radius: 0.75rem; }
.rounded-full { border-radius: 9999px; }

/* Shadows */
.shadow-sm { box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05); }
.shadow { box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1); }
.shadow-md { box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1); }
.shadow-lg { box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1); }

/* Interactive & Forms */
.cursor-pointer { cursor: pointer; }
.cursor-not-allowed { cursor: not-allowed; }
.transition { transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
.duration-150 { transition-duration: 150ms; }
.duration-200 { transition-duration: 200ms; }
.hover\\:bg-blue-700:hover { background-color: #1d4ed8; }
.hover\\:bg-blue-800:hover { background-color: #1e40af; }
.hover\\:bg-gray-100:hover { background-color: #f3f4f6; }
.hover\\:bg-gray-200:hover { background-color: #e5e7eb; }
.hover\\:bg-red-700:hover { background-color: #b91c1c; }
.focus\\:outline-none:focus { outline: 2px solid transparent; outline-offset: 2px; }
.focus\\:ring-2:focus { box-shadow: 0 0 0 2px #fff, 0 0 0 4px #2563eb; }
.disabled\\:opacity-50:disabled { opacity: 0.5; }
.disabled\\:cursor-not-allowed:disabled { cursor: not-allowed; }
`;
