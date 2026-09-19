export const getOrchestratorBaseUrl = (): string => {
  return process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:4000';
};
