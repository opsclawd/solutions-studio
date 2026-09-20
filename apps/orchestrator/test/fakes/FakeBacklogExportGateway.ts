import type {
  IBacklogExportGateway,
  ExportWorkItemParams,
  ExportWorkItemResult
} from '../../src/application/ports/backlog/IBacklogExportGateway.js';
import type { BacklogExportMapping } from '@solutions-studio/domain';

export class FakeBacklogExportGateway implements IBacklogExportGateway {
  public readonly providerId: string;
  public createCalls: ExportWorkItemParams[] = [];
  public updateCalls: (ExportWorkItemParams & { existingMapping: BacklogExportMapping })[] = [];

  private nextWorkItemId = 100;
  private queuedErrors: Error[] = [];
  private cannedResults = new Map<string, ExportWorkItemResult>();

  constructor(providerId = 'fake') {
    this.providerId = providerId;
  }

  queueError(error: Error): void {
    this.queuedErrors.push(error);
  }

  setResultForStory(storyId: string, result: ExportWorkItemResult): void {
    this.cannedResults.set(storyId, result);
  }

  async createWorkItem(params: ExportWorkItemParams): Promise<ExportWorkItemResult> {
    this.createCalls.push(params);

    if (this.queuedErrors.length > 0) {
      const error = this.queuedErrors.shift()!;
      throw error;
    }

    if (this.cannedResults.has(params.payload.story.id)) {
      return this.cannedResults.get(params.payload.story.id)!;
    }

    const idNum = ++this.nextWorkItemId;
    return {
      externalWorkItemId: String(idNum),
      externalUrl: `https://fake-backlog.test/${params.targetContainer}/items/${idNum}`,
      metadata: { issueNumber: idNum }
    };
  }

  async updateWorkItem(
    params: ExportWorkItemParams & { existingMapping: BacklogExportMapping }
  ): Promise<ExportWorkItemResult> {
    this.updateCalls.push(params);

    if (this.queuedErrors.length > 0) {
      const error = this.queuedErrors.shift()!;
      throw error;
    }

    if (this.cannedResults.has(params.payload.story.id)) {
      return this.cannedResults.get(params.payload.story.id)!;
    }

    return {
      externalWorkItemId: params.existingMapping.externalWorkItemId,
      externalUrl:
        params.existingMapping.externalUrl ??
        `https://fake-backlog.test/${params.targetContainer}/items/${params.existingMapping.externalWorkItemId}`,
      metadata: { updated: true }
    };
  }

  public existingRemoteItems = new Map<string, ExportWorkItemResult>();

  async findWorkItem(params: ExportWorkItemParams): Promise<ExportWorkItemResult | undefined> {
    return this.existingRemoteItems.get(params.payload.story.id);
  }

  reset(): void {
    this.createCalls = [];
    this.updateCalls = [];
    this.queuedErrors = [];
    this.cannedResults.clear();
    this.existingRemoteItems.clear();
  }
}
