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
    const isStory =
      request.prompt.toLowerCase().includes('gherkin') ||
      request.prompt.toLowerCase().includes('user story') ||
      request.prompt.toLowerCase().includes('story projection') ||
      request.prompt.toLowerCase().includes('acceptance criteria');

    const isOpenApi =
      request.prompt.toLowerCase().includes('openapi') ||
      request.prompt.toLowerCase().includes('api specification') ||
      request.prompt.toLowerCase().includes('api contract');

    const isSql =
      request.prompt.toLowerCase().includes('postgresql') ||
      request.prompt.toLowerCase().includes('sql ddl') ||
      request.prompt.toLowerCase().includes('relational schema');

    const isPrototype =
      request.prompt.toLowerCase().includes('prototype') ||
      request.prompt.toLowerCase().includes('@baseline');

    const isStateDiagram =
      request.prompt.toLowerCase().includes('state-diagram') ||
      request.prompt.toLowerCase().includes('state diagram');

    let text: string;
    if (isStory) {
      const baselineMatch = request.prompt.match(/baseline\s+([A-Za-z0-9_-]+)/i);
      const baselineId = baselineMatch ? baselineMatch[1] : 'BASE-001';
      const reqMatches = [...request.prompt.matchAll(/-\s*\[([A-Za-z0-9_-]+)\]/g)].map((m) => m[1]);
      const revisions = reqMatches.length > 0 ? reqMatches : ['REQ-001-R1'];

      const polMatches = [
        ...request.prompt.matchAll(/(?:#|--)?\s*@policy-constraints\s+([^\r\n]+)/g)
      ];
      let polHeader = '';
      let firstPol = '';
      if (polMatches.length > 0) {
        const rawPols = polMatches[0][1].trim();
        polHeader = `\n# @policy-constraints ${rawPols}`;
        firstPol = rawPols.split(/[\s,]+/)[0];
      }

      const edMatches = [
        ...request.prompt.matchAll(/(?:#|--)?\s*@engineering-decisions\s+([^\r\n]+)/g)
      ];
      let edHeader = '';
      if (edMatches.length > 0) {
        edHeader = `\n# @engineering-decisions ${edMatches[0][1].trim()}`;
      }

      const polTag = firstPol ? ` @policy-constraints:${firstPol}` : '';
      const scenario2 =
        revisions.length > 1
          ? `\n  @requirements:${revisions[1]}\n  Scenario: Secondary execution path\n    Given the prerequisites are satisfied\n    When the secondary operation is requested\n    Then the operation completes without error`
          : '';

      text = [
        '```gherkin',
        `# @baseline ${baselineId}`,
        `# @requirements ${revisions.join(', ')}${polHeader}${edHeader}`,
        '',
        'Feature: Auto-Generated Baseline Story',
        '  As a verified actor',
        '  I want to execute required baseline capabilities',
        '  So that business intent and constraints are fulfilled',
        '',
        `  @requirements:${revisions[0]}${polTag}`,
        '  Scenario: Primary execution path',
        '    Given the system is in a valid state',
        '    When the primary workflow is triggered',
        '    Then expected results are produced successfully' + scenario2,
        '```'
      ].join('\n');
    } else if (isOpenApi) {
      const baselineMatch = request.prompt.match(/baseline\s+([A-Za-z0-9_-]+)/i);
      const baselineId = baselineMatch ? baselineMatch[1] : 'BASE-001';
      const reqMatches = [...request.prompt.matchAll(/-\s*\[([A-Za-z0-9_-]+)\]/g)].map((m) => m[1]);
      const revisions = reqMatches.length > 0 ? reqMatches.join(', ') : 'REQ-001-R1';

      const polMatches = [...request.prompt.matchAll(/#\s*@policy-constraints\s+([^\r\n]+)/g)];
      let polHeader = '';
      if (polMatches.length > 0) {
        polHeader = `\n# @policy-constraints ${polMatches[0][1].trim()}`;
      }

      const edMatches = [...request.prompt.matchAll(/#\s*@engineering-decisions\s+([^\r\n]+)/g)];
      let edHeader = '';
      if (edMatches.length > 0) {
        edHeader = `\n# @engineering-decisions ${edMatches[0][1].trim()}`;
      }

      text = [
        '```yaml',
        `# @baseline ${baselineId}`,
        `# @requirements ${revisions}${polHeader}${edHeader}`,
        'openapi: 3.1.0',
        'info:',
        '  title: Auto-Generated Baseline API',
        '  version: 1.0.0',
        'paths:',
        '  /health:',
        '    get:',
        '      operationId: getHealthStatus',
        '      responses:',
        "        '200':",
        '          description: Health check OK',
        '          content:',
        '            application/json:',
        '              schema:',
        '                type: object',
        '                properties:',
        '                  status:',
        '                    type: string',
        '```'
      ].join('\n');
    } else if (isSql) {
      const baselineMatch = request.prompt.match(/baseline\s+([A-Za-z0-9_-]+)/i);
      const baselineId = baselineMatch ? baselineMatch[1] : 'BASE-001';
      const reqMatches = [...request.prompt.matchAll(/-\s*\[([A-Za-z0-9_-]+)\]/g)].map((m) => m[1]);
      const revisions = reqMatches.length > 0 ? reqMatches.join(', ') : 'REQ-001-R1';

      const polMatches = [...request.prompt.matchAll(/--\s*@policy-constraints\s+([^\r\n]+)/g)];
      let polHeader = '';
      if (polMatches.length > 0) {
        polHeader = `\n-- @policy-constraints ${polMatches[0][1].trim()}`;
      }

      const edMatches = [...request.prompt.matchAll(/--\s*@engineering-decisions\s+([^\r\n]+)/g)];
      let edHeader = '';
      if (edMatches.length > 0) {
        edHeader = `\n-- @engineering-decisions ${edMatches[0][1].trim()}`;
      }

      text = [
        '```sql',
        `-- @baseline ${baselineId}`,
        `-- @requirements ${revisions}${polHeader}${edHeader}`,
        'CREATE TABLE accounts (',
        '  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
        '  email TEXT NOT NULL UNIQUE',
        ');',
        '```'
      ].join('\n');
    } else if (isPrototype) {
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
