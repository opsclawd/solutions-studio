import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedHttpRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: http.IncomingHttpHeaders;
  readonly rawBody: string;
  readonly jsonBody?: unknown;
}

export interface StubResponse {
  readonly status: number;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
}

export type StubRequestHandler = (req: RecordedHttpRequest) => StubResponse | Promise<StubResponse>;

export class GitHubHttpStubServer {
  private server: http.Server | null = null;
  private port: number = 0;
  public readonly requests: RecordedHttpRequest[] = [];
  public readonly issues: Array<{
    id: number;
    number: number;
    title: string;
    body: string;
    html_url: string;
    state: string;
  }> = [];
  private queuedResponses: StubResponse[] = [];
  private routeHandlers: {
    method: string;
    pathPrefix: string;
    handler: StubRequestHandler;
  }[] = [];
  private defaultIssueNumber = 42;

  get url(): string {
    if (!this.port) {
      throw new Error('GitHubHttpStubServer is not running');
    }
    return `http://127.0.0.1:${this.port}`;
  }

  async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', async () => {
          const rawBody = Buffer.concat(chunks).toString('utf8');
          let jsonBody: unknown = undefined;
          if (
            rawBody &&
            (req.headers['content-type']?.includes('json') || rawBody.startsWith('{'))
          ) {
            try {
              jsonBody = JSON.parse(rawBody);
            } catch {
              // ignore
            }
          }

          const recorded: RecordedHttpRequest = {
            method: req.method || 'GET',
            url: req.url || '/',
            headers: req.headers,
            rawBody,
            jsonBody
          };
          this.requests.push(recorded);

          // 1. Check queued response
          if (this.queuedResponses.length > 0) {
            const canned = this.queuedResponses.shift()!;
            this.sendResponse(res, canned);
            return;
          }

          // 2. Check custom route handlers
          for (const route of this.routeHandlers) {
            if (
              route.method.toUpperCase() === (req.method || 'GET').toUpperCase() &&
              (req.url || '').startsWith(route.pathPrefix)
            ) {
              const result = await route.handler(recorded);
              this.sendResponse(res, result);
              return;
            }
          }

          // 3. Default GitHub REST API emulation
          const url = req.url || '';
          if (req.method === 'GET' && url.includes('/issues')) {
            this.sendResponse(res, {
              status: 200,
              headers: { 'content-type': 'application/json' },
              body: this.issues
            });
            return;
          }

          if (req.method === 'POST' && url.includes('/issues')) {
            const issueNum = ++this.defaultIssueNumber;
            const newIssue = {
              id: 10000 + issueNum,
              number: issueNum,
              title: (jsonBody as { title?: string })?.title || 'Story',
              body: (jsonBody as { body?: string })?.body || '',
              html_url: `https://github.com/mock/mock/issues/${issueNum}`,
              state: 'open'
            };
            this.issues.push(newIssue);
            this.sendResponse(res, {
              status: 201,
              headers: { 'content-type': 'application/json' },
              body: newIssue
            });
            return;
          }

          if (req.method === 'PATCH' && url.includes('/issues/')) {
            const parts = url.split('/');
            const numStr = parts[parts.length - 1];
            const issueNum = parseInt(numStr, 10) || 42;
            const existing = this.issues.find((i) => i.number === issueNum);
            const updatedIssue = {
              id: existing?.id || 10000 + issueNum,
              number: issueNum,
              title: (jsonBody as { title?: string })?.title || existing?.title || 'Updated Story',
              body: (jsonBody as { body?: string })?.body || existing?.body || '',
              html_url: existing?.html_url || `https://github.com/mock/mock/issues/${issueNum}`,
              state: 'open'
            };
            if (existing) {
              Object.assign(existing, updatedIssue);
            }
            this.sendResponse(res, {
              status: 200,
              headers: { 'content-type': 'application/json' },
              body: updatedIssue
            });
            return;
          }

          // Fallback
          this.sendResponse(res, {
            status: 404,
            headers: { 'content-type': 'application/json' },
            body: { message: 'Not Found' }
          });
        });
      });

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address() as AddressInfo;
        this.port = addr.port;
        resolve(this.url);
      });

      this.server.on('error', reject);
    });
  }

  private sendResponse(res: http.ServerResponse, stubRes: StubResponse): void {
    const headers = stubRes.headers ?? { 'content-type': 'application/json' };
    res.writeHead(stubRes.status, headers);
    if (stubRes.body !== undefined) {
      if (typeof stubRes.body === 'string') {
        res.end(stubRes.body);
      } else {
        res.end(JSON.stringify(stubRes.body));
      }
    } else {
      res.end();
    }
  }

  queueResponse(status: number, body?: unknown, headers?: Record<string, string>): void {
    this.queuedResponses.push({ status, body, headers });
  }

  on(method: string, pathPrefix: string, handler: StubRequestHandler): void {
    this.routeHandlers.push({ method, pathPrefix, handler });
  }

  reset(): void {
    this.requests.length = 0;
    this.issues.length = 0;
    this.queuedResponses = [];
    this.routeHandlers = [];
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve) => {
      this.server!.close(() => {
        this.server = null;
        this.port = 0;
        resolve();
      });
    });
  }
}
