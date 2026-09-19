import type {
  IGenerationGateway,
  GenerationRequest,
  GenerationResult
} from '../../application/ports/generation/IGenerationGateway.js';

export class DeterministicFallbackGateway implements IGenerationGateway {
  private defaultResponse: string =
    'graph TD;\n  Start([Start Request]) --> Step1[Validate];\n  Step1 --> Complete([Complete]);';

  constructor(defaultResponse?: string) {
    if (defaultResponse) {
      this.defaultResponse = defaultResponse;
    }
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const isPrototype =
      request.prompt.toLowerCase().includes('prototype') ||
      request.prompt.toLowerCase().includes('@baseline');

    const isStateDiagram =
      request.prompt.toLowerCase().includes('state-diagram') ||
      request.prompt.toLowerCase().includes('state diagram');

    let text: string;
    if (isPrototype) {
      const baselineMatch = request.prompt.match(/baseline\s+([A-Za-z0-9_-]+)/i);
      const baselineId = baselineMatch ? baselineMatch[1] : 'BASE-001';
      const reqMatches = [...request.prompt.matchAll(/-\s*\[([A-Za-z0-9_-]+)\]/g)].map((m) => m[1]);
      const revisions = reqMatches.length > 0 ? reqMatches.join(', ') : 'REQ-001-R1';

      text = [
        '/**',
        ` * @baseline ${baselineId}`,
        ` * @requirements ${revisions}`,
        ' */',
        "import React, { useState } from 'react';",
        '',
        'export default function PrototypeComponent() {',
        '  const [count, setCount] = useState(0);',
        '  return (',
        '    <div className="p-4 bg-white rounded shadow">',
        '      <h1 className="text-lg font-bold">Interactive Prototype</h1>',
        '      <p className="text-sm text-gray-600">Counter: {count}</p>',
        '      <button',
        '        onClick={() => setCount((c) => c + 1)}',
        '        className="mt-2 px-3 py-1 bg-blue-600 text-white rounded text-sm"',
        '      >',
        '        Increment',
        '      </button>',
        '    </div>',
        '  );',
        '}'
      ].join('\n');
    } else if (isStateDiagram) {
      text =
        'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Processing: Submit\n  Processing --> Success: Complete\n  Success --> [*]';
    } else {
      text = this.defaultResponse;
    }

    return {
      text,
      metadata: {
        provider: 'fake',
        model: 'deterministic-fallback',
        durationMs: 1
      }
    };
  }
}
