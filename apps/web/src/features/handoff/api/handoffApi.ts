import type {
  EngineeringHandoffBundleDto,
  StoryDependencyGraphDto,
  StoryDto,
  UpdateStoryDependenciesRequestDto,
  CandidatePromotionStatusDto,
  ValidationRunRecordDto,
  CandidateApprovalRecordDto,
  CreateApprovalRequestDto,
  RevokeApprovalRequestDto,
  GovernanceAuditExportDto
} from '@solutions-studio/contracts';
import {
  EngineeringHandoffBundleDtoSchema,
  StoryDependencyGraphDtoSchema,
  StoryDtoSchema,
  CandidatePromotionStatusDtoSchema,
  ValidationRunRecordDtoSchema,
  CandidateApprovalRecordDtoSchema,
  GovernanceAuditExportDtoSchema
} from '@solutions-studio/contracts';
import { apiClient } from '@/features/review/api/client';
import { listBaselines as listBaselinesFromApi } from '@/features/review/api/baselinesApi';

export async function getEngineeringHandoffBundle(
  baselineId: string
): Promise<EngineeringHandoffBundleDto> {
  const data = await apiClient<EngineeringHandoffBundleDto>(
    `/api/baselines/${encodeURIComponent(baselineId)}/handoff`,
    {
      method: 'GET'
    }
  );
  return EngineeringHandoffBundleDtoSchema.parse(data);
}

export async function getStoryDependencyGraph(
  baselineId: string,
  options?: { includeReadiness?: boolean; strict?: boolean }
): Promise<StoryDependencyGraphDto> {
  const params = new URLSearchParams();
  if (options?.includeReadiness !== undefined) {
    params.set('includeReadiness', String(options.includeReadiness));
  }
  if (options?.strict !== undefined) {
    params.set('strict', String(options.strict));
  }
  const query = params.toString() ? `?${params.toString()}` : '';

  const data = await apiClient<StoryDependencyGraphDto>(
    `/api/baselines/${encodeURIComponent(baselineId)}/dependency-graph${query}`,
    {
      method: 'GET'
    }
  );
  return StoryDependencyGraphDtoSchema.parse(data);
}

export async function updateStoryDependencies(
  storyId: string,
  dependencies: string[]
): Promise<StoryDto> {
  const payload: UpdateStoryDependenciesRequestDto = {
    dependencies
  };
  const data = await apiClient<StoryDto>(
    `/api/stories/${encodeURIComponent(storyId)}/dependencies`,
    {
      method: 'PUT',
      body: JSON.stringify(payload)
    }
  );
  return StoryDtoSchema.parse(data);
}

export async function listAvailableBaselines(): Promise<string[]> {
  try {
    const baselines = await listBaselinesFromApi();
    return baselines.map((b) => b.id);
  } catch {
    return [];
  }
}

export async function getCurrentCandidateSha(): Promise<string | undefined> {
  try {
    const data = await apiClient<{ candidateSha: string }>(`/api/governance/current-candidate`, {
      method: 'GET'
    });
    return data?.candidateSha;
  } catch {
    return undefined;
  }
}

export async function getCandidatePromotionStatus(
  candidateSha: string
): Promise<CandidatePromotionStatusDto> {
  const data = await apiClient<CandidatePromotionStatusDto>(
    `/api/governance/candidates/${encodeURIComponent(candidateSha)}/status`,
    {
      method: 'GET'
    }
  );
  return CandidatePromotionStatusDtoSchema.parse(data);
}

export async function listValidationRuns(candidateSha: string): Promise<ValidationRunRecordDto[]> {
  const data = await apiClient<ValidationRunRecordDto[]>(
    `/api/governance/candidates/${encodeURIComponent(candidateSha)}/validation-runs`,
    {
      method: 'GET'
    }
  );
  return (data ?? []).map((item) => ValidationRunRecordDtoSchema.parse(item));
}

export async function listGovernanceApprovals(
  candidateSha: string
): Promise<CandidateApprovalRecordDto[]> {
  const data = await apiClient<CandidateApprovalRecordDto[]>(
    `/api/governance/candidates/${encodeURIComponent(candidateSha)}/approvals`,
    {
      method: 'GET'
    }
  );
  return (data ?? []).map((item) => CandidateApprovalRecordDtoSchema.parse(item));
}

export async function createGovernanceApproval(
  input: CreateApprovalRequestDto
): Promise<CandidateApprovalRecordDto> {
  const data = await apiClient<CandidateApprovalRecordDto>(`/api/governance/approvals`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
  return CandidateApprovalRecordDtoSchema.parse(data);
}

export async function revokeGovernanceApproval(
  approvalId: string,
  rationale: string
): Promise<CandidateApprovalRecordDto> {
  const payload: RevokeApprovalRequestDto = {
    rationale
  };
  const data = await apiClient<CandidateApprovalRecordDto>(
    `/api/governance/approvals/${encodeURIComponent(approvalId)}/revoke`,
    {
      method: 'POST',
      body: JSON.stringify(payload)
    }
  );
  return CandidateApprovalRecordDtoSchema.parse(data);
}

export async function exportGovernanceAudit(
  candidateSha: string
): Promise<GovernanceAuditExportDto> {
  const data = await apiClient<GovernanceAuditExportDto>(
    `/api/governance/audit/export?candidateSha=${encodeURIComponent(candidateSha)}`,
    {
      method: 'GET'
    }
  );
  return GovernanceAuditExportDtoSchema.parse(data);
}
