export const REVIEW_VERDICTS = Object.freeze([
  'accepted',
  'accepted_with_follow_up',
  'rejected',
  'blocked_pending_user_decision'
])

export const REVIEW_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'verdict',
    'summary',
    'failedRequirements',
    'failedAcceptanceCriteria',
    'testsRun',
    'evidence',
    'followUp',
    'expectedCorrection'
  ],
  properties: {
    verdict: { type: 'string', enum: REVIEW_VERDICTS },
    summary: { type: 'string' },
    failedRequirements: { type: 'array', items: { type: 'string' } },
    failedAcceptanceCriteria: { type: 'array', items: { type: 'string' } },
    testsRun: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'array', items: { type: 'string' } },
    followUp: { type: 'array', items: { type: 'string' } },
    expectedCorrection: { type: 'string' }
  }
})

function requireStringArray(record, key) {
  if (!Array.isArray(record[key]) || record[key].some((item) => typeof item !== 'string')) {
    throw new Error(`review result ${key} must be an array of strings`)
  }
}

export function validateReviewResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('review result must be a JSON object')
  }
  if (!REVIEW_VERDICTS.includes(value.verdict)) {
    throw new Error(`review result verdict is invalid: ${value.verdict}`)
  }
  if (typeof value.summary !== 'string' || value.summary.trim().length === 0) {
    throw new Error('review result summary must be a non-empty string')
  }
  requireStringArray(value, 'failedRequirements')
  requireStringArray(value, 'failedAcceptanceCriteria')
  requireStringArray(value, 'testsRun')
  requireStringArray(value, 'evidence')
  if (value.followUp !== undefined) {
    requireStringArray(value, 'followUp')
  }
  if (value.expectedCorrection !== undefined && typeof value.expectedCorrection !== 'string') {
    throw new Error('review result expectedCorrection must be a string when present')
  }
  return {
    verdict: value.verdict,
    summary: value.summary,
    failedRequirements: value.failedRequirements,
    failedAcceptanceCriteria: value.failedAcceptanceCriteria,
    testsRun: value.testsRun,
    evidence: value.evidence,
    followUp: value.followUp ?? [],
    ...(value.expectedCorrection ? { expectedCorrection: value.expectedCorrection } : {})
  }
}
