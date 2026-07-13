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
    if (!verificationEvidence.ok) {
      return {
        verdict: 'rejected',
        summary: 'Deterministic qFoundry verification failed or was incomplete.',
        failedRequirements: task.requirements ?? [],
        failedAcceptanceCriteria: task.acceptanceCriteria ?? [],
        testsRun: verificationEvidence.results.map(
          (result) => `${result.command} ${result.args.join(' ')}`
        ),
        evidence: verificationEvidence.failures,
        expectedCorrection: 'Make the implementation pass the required deterministic verification.'
      }
    }
    const review = await reviewer.review({
      projectRoot,
      contractText,
      task,
      workerDone: messagePayload(workerDoneMessage),
      gitEvidence,
      verificationEvidence,
      workerReportText
    })
    if (review.verdict !== 'accepted' && review.verdict !== 'accepted_with_follow_up') {
      return review
    }
    return verificationEvidence.ok
      ? review
      : {
          ...review,
          verdict: 'rejected',
          summary: `Rejected despite reviewer acceptance: ${verificationEvidence.failures.join('; ')}`,
          failedRequirements: task.requirements ?? [],
          failedAcceptanceCriteria: task.acceptanceCriteria ?? [],
          evidence: [...(review.evidence ?? []), ...verificationEvidence.failures]
        }
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
