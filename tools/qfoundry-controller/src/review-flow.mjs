import path from 'node:path'

import { collectGitEvidence } from './git-evidence.mjs'
import { readWorkerReport } from './reviewer.mjs'
import { readTextIfExists, resolveProjectPath } from './state-store.mjs'
import { runVerificationCommands } from './verification-runner.mjs'

export async function buildTaskReview({
  projectRoot,
  state,
  task,
  workerDoneMessage,
  reviewer,
  messagePayload,
  now
}) {
  try {
    const contractPath = state.contract.path ?? path.join('.qfoundry', 'PROJECT_CONTRACT.md')
    const contractText = await readTextIfExists(resolveProjectPath(projectRoot, contractPath))
    const workerReportText = await readWorkerReport(projectRoot, task.reportPath)
    const gitEvidence = await collectGitEvidence({
      task,
      timeoutMs: state.settings.gitTimeoutMs,
      maxDiffBytes: state.settings.maxDiffBytes
    })
    const verificationEvidence = await runVerificationCommands({
      task,
      timeoutMs: state.settings.verificationTimeoutMs,
      maxOutputBytes: state.settings.maxVerificationOutputBytes
    })
    task.gitEvidence = gitEvidence
    task.verificationEvidence = verificationEvidence

    const review = await reviewer.review({
      projectRoot,
      contractText,
      task,
      workerDone: messagePayload(workerDoneMessage),
      gitEvidence,
      verificationEvidence,
      workerReportText
    })

    if (!verificationEvidence.ok) {
      const deterministicTests = verificationEvidence.results.map(
        (result) => `${result.command} ${result.args.join(' ')}`
      )
      return {
        ...review,
        verdict: 'rejected',
        summary:
          review.verdict === 'accepted' || review.verdict === 'accepted_with_follow_up'
            ? 'Rejected despite reviewer acceptance: deterministic qFoundry verification failed or was incomplete.'
            : review.summary,
        failedRequirements: [
          ...new Set([...(review.failedRequirements ?? []), ...(task.requirements ?? [])])
        ],
        failedAcceptanceCriteria: [
          ...new Set([
            ...(review.failedAcceptanceCriteria ?? []),
            ...(task.acceptanceCriteria ?? [])
          ])
        ],
        testsRun: [...(review.testsRun ?? []), ...deterministicTests],
        evidence: [...(review.evidence ?? []), ...verificationEvidence.failures],
        expectedCorrection:
          review.expectedCorrection ??
          'Make the implementation pass the required deterministic verification.'
      }
    }
    if (review.verdict !== 'accepted' && review.verdict !== 'accepted_with_follow_up') {
      return review
    }
    return review
  } catch (error) {
    task.verificationFailure = {
      at: now().toISOString(),
      message: error.message
    }
    return {
      verdict: 'rejected',
      summary: `qFoundry verification failed closed: ${error.message}`,
      failedRequirements: task.requirements ?? [],
      failedAcceptanceCriteria: task.acceptanceCriteria ?? [],
      testsRun: [],
      evidence: [error.message],
      expectedCorrection:
        'Resolve the verification or evidence collection failure before requesting acceptance.'
    }
  }
}
