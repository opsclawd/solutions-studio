import type { EvaluationReportDto } from '@solutions-studio/contracts';
import {
  EvaluateRequirementsCompilerUseCase,
  type EvaluateRequirementsCompilerOptions,
  type EvaluationRunExecutionResult,
  type EvaluateRequirementsCompilerPorts
} from './EvaluateRequirementsCompilerUseCase.js';

export {
  EvaluateRequirementsCompilerUseCase,
  type EvaluateRequirementsCompilerOptions,
  type EvaluationRunExecutionResult,
  type EvaluateRequirementsCompilerPorts
};

export * from './ports.js';

export interface LegacyEvaluationSummary {
  readonly totalFixtures: number;
  readonly passedFixtures: number;
  readonly failedFixtures: number;
  readonly totalCategories: number;
  readonly coveredCategories: readonly string[];
}

export type LegacyCompatibleEvaluationReport = EvaluationReportDto & {
  readonly summary: LegacyEvaluationSummary;
};
