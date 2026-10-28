export type { Fact } from './types';

export {
  isEligibleForGeneration,
  isEligibleForSuggestion,
  eligibilityReason,
  type EligibilityReason,
} from './eligibility';

export {
  selectRelevantFacts,
  type SelectRelevantFactsOptions,
} from './selection';

export {
  buildFactContext,
  type FactContextEntry,
  type FactContextOptions,
} from './context';

export {
  listFacts,
  getFact,
  createFact,
  updateFact,
  approveFact,
  setFactActive,
} from './repository';

