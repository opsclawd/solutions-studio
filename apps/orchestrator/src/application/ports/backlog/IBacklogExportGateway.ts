import type {
  Story,
  StoryId,
  RequirementsBaseline,
  RequirementRevision,
  PolicyConstraintRevision,
  EngineeringDecision,
  BacklogExportMapping
} from '@solutions-studio/domain';

export interface BacklogExportPrerequisiteRef {
  readonly storyId: StoryId;
  readonly externalWorkItemId?: string;
  readonly title?: string;
}

export interface BacklogExportPayload {
  readonly story: Story;
  readonly baseline: RequirementsBaseline;
  readonly requirements: readonly RequirementRevision[];
  readonly policyConstraints: readonly PolicyConstraintRevision[];
  readonly engineeringDecisions: readonly EngineeringDecision[];
  readonly contentHash: string;
  readonly targetContainer: string;
  readonly prerequisites: readonly BacklogExportPrerequisiteRef[];
}

export interface ExportWorkItemParams {
  readonly targetContainer: string;
  readonly payload: BacklogExportPayload;
  readonly credentials?: {
    readonly token?: string;
  };
}

export interface ExportWorkItemResult {
  readonly externalWorkItemId: string;
  readonly externalUrl?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface IBacklogExportGateway {
  readonly providerId: string;
  createWorkItem(params: ExportWorkItemParams): Promise<ExportWorkItemResult>;
  updateWorkItem(
    params: ExportWorkItemParams & { readonly existingMapping: BacklogExportMapping }
  ): Promise<ExportWorkItemResult>;
  findWorkItem?(params: ExportWorkItemParams): Promise<ExportWorkItemResult | undefined>;
}
