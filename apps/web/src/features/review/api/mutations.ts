import type {
  AcceptRequirementRequestDto,
  RejectRequirementRequestDto,
  ReviseRequirementRequestDto,
  ResolveRequirementRequestDto,
  DispositionFindingRequestDto,
  ReopenFindingRequestDto,
  RequirementRevisionDto,
  CandidateFindingDto,
  RecordRequirementDiscoveryRequestDto,
  RecordFindingDiscoveryRequestDto
} from '@solutions-studio/contracts';
import {
  RequirementRevisionDtoSchema,
  CandidateFindingDtoSchema
} from '@solutions-studio/contracts';
import { apiClient } from './client';

export async function acceptRequirement(
  revisionId: string,
  body: AcceptRequirementRequestDto
): Promise<RequirementRevisionDto> {
  const data = await apiClient<RequirementRevisionDto>(
    `/api/requirements/${encodeURIComponent(revisionId)}/accept`,
    {
      method: 'POST',
      body: JSON.stringify(body)
    }
  );
  return RequirementRevisionDtoSchema.parse(data);
}

export async function rejectRequirement(
  revisionId: string,
  body: RejectRequirementRequestDto
): Promise<RequirementRevisionDto> {
  const data = await apiClient<RequirementRevisionDto>(
    `/api/requirements/${encodeURIComponent(revisionId)}/reject`,
    {
      method: 'POST',
      body: JSON.stringify(body)
    }
  );
  return RequirementRevisionDtoSchema.parse(data);
}

export async function reviseRequirement(
  revisionId: string,
  body: ReviseRequirementRequestDto
): Promise<RequirementRevisionDto> {
  const data = await apiClient<RequirementRevisionDto>(
    `/api/requirements/${encodeURIComponent(revisionId)}/revise`,
    {
      method: 'POST',
      body: JSON.stringify(body)
    }
  );
  return RequirementRevisionDtoSchema.parse(data);
}

export async function resolveRequirement(
  revisionId: string,
  body: ResolveRequirementRequestDto
): Promise<RequirementRevisionDto> {
  const data = await apiClient<RequirementRevisionDto>(
    `/api/requirements/${encodeURIComponent(revisionId)}/resolve`,
    {
      method: 'POST',
      body: JSON.stringify(body)
    }
  );
  return RequirementRevisionDtoSchema.parse(data);
}

export async function dispositionFinding(
  findingId: string,
  body: DispositionFindingRequestDto
): Promise<CandidateFindingDto> {
  const data = await apiClient<CandidateFindingDto>(
    `/api/findings/${encodeURIComponent(findingId)}/disposition`,
    {
      method: 'POST',
      body: JSON.stringify(body)
    }
  );
  return CandidateFindingDtoSchema.parse(data);
}

export async function reopenFinding(
  findingId: string,
  body: ReopenFindingRequestDto
): Promise<CandidateFindingDto> {
  const data = await apiClient<CandidateFindingDto>(
    `/api/findings/${encodeURIComponent(findingId)}/reopen`,
    {
      method: 'POST',
      body: JSON.stringify(body)
    }
  );
  return CandidateFindingDtoSchema.parse(data);
}

export async function recordRequirementDiscovery(
  body: RecordRequirementDiscoveryRequestDto
): Promise<RequirementRevisionDto> {
  const data = await apiClient<RequirementRevisionDto>('/api/requirements/discoveries', {
    method: 'POST',
    body: JSON.stringify(body)
  });
  return RequirementRevisionDtoSchema.parse(data);
}

export async function recordFindingDiscovery(
  body: RecordFindingDiscoveryRequestDto
): Promise<CandidateFindingDto> {
  const data = await apiClient<CandidateFindingDto>('/api/findings/discoveries', {
    method: 'POST',
    body: JSON.stringify(body)
  });
  return CandidateFindingDtoSchema.parse(data);
}
