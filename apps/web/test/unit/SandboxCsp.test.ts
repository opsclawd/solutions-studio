import { describe, it, expect } from 'vitest';
import { buildSandboxCsp, buildCspMetaTag } from '../../src/features/prototype-sandbox/SandboxCsp';

describe('SandboxCsp', () => {
  it('generates restrictive default Content Security Policy', () => {
    const csp = buildSandboxCsp();

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'unsafe-inline' 'unsafe-eval'");
    expect(csp).toContain("style-src 'unsafe-inline'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
  });

  it('generates valid meta tag string', () => {
    const meta = buildCspMetaTag();
    expect(meta.startsWith('<meta http-equiv="Content-Security-Policy" content="')).toBe(true);
    expect(meta.endsWith('">')).toBe(true);
    expect(meta).toContain("connect-src 'none'");
  });

  it('honors customization options', () => {
    const csp = buildSandboxCsp({
      allowEval: false,
      allowInlineStyles: false,
      allowedImageSources: ["'none'"]
    });

    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain("style-src 'unsafe-inline'");
    expect(csp).toContain("img-src 'none'");
  });
});
