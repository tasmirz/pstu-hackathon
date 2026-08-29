export type ReputationTier = 'EXCELLENT' | 'GOOD' | 'FAIR' | 'LOW';

export function reputationTier(score: number): ReputationTier {
  if (score >= 80) return 'EXCELLENT';
  if (score >= 60) return 'GOOD';
  if (score >= 40) return 'FAIR';
  return 'LOW';
}
