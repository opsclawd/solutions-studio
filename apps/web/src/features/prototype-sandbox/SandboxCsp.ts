/**
 * Content Security Policy configuration for the Prototype Sandbox iframe.
 *
 * This policy isolates generated UI code:
 * - default-src 'none': Prevents loading of any unspecified resource types.
 * - script-src 'unsafe-inline' 'unsafe-eval': Required to execute the client-compiled
 *   transpiled React bundle inside the iframe memory context.
 * - style-src 'unsafe-inline': Permits the inlined Tailwind utility styles.
 * - connect-src 'none': Strictly blocks all outbound network requests (fetch, XHR, WebSocket, EventSource).
 * - img-src 'data:': Allows inline SVG/data-URI icons while blocking remote image tracking/leakage.
 * - font-src 'data:': Allows embedded data-URI fonts.
 * - object-src 'none': Blocks plugins/Flash/applets.
 * - base-uri 'none': Prevents DOM base tag injection.
 * - form-action 'none': Blocks HTML form actions from navigating the frame.
 */

export interface SandboxCspOptions {
  allowEval?: boolean;
  allowInlineStyles?: boolean;
  allowedImageSources?: string[];
}

export function buildSandboxCsp(options: SandboxCspOptions = {}): string {
  const allowEval = options.allowEval ?? true;
  const allowInlineStyles = options.allowInlineStyles ?? true;
  const imageSources = options.allowedImageSources ?? ["'self'", 'data:'];

  const directives: Record<string, string[]> = {
    'default-src': ["'none'"],
    'script-src': [
      "'unsafe-inline'",
      ...(allowEval ? ["'unsafe-eval'"] : []),
    ],
    'style-src': [
      ...(allowInlineStyles ? ["'unsafe-inline'"] : []),
    ],
    'connect-src': ["'none'"],
    'img-src': imageSources,
    'font-src': ['data:'],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
  };

  return Object.entries(directives)
    .map(([directive, sources]) => `${directive} ${sources.join(' ')}`)
    .join('; ');
}

export function buildCspMetaTag(options: SandboxCspOptions = {}): string {
  const csp = buildSandboxCsp(options);
  return `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
}
