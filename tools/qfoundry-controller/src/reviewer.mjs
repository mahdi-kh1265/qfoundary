import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const REVIEW_INPUT_DIR = path.join('.qfoundry', 'review-inputs')

function shellCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      resolve({ code, stdout, stderr })
    })
    if (options.stdin) {
      child.stdin.end(options.stdin)
    } else {
      child.stdin.end()
    }
  })
}

export function buildReviewPrompt({ contractText, task, workerDone, diffText, workerReportText }) {
  return `You are the qFoundry Codex supervisor.

Review the worker result independently. A valid worker_done is completion
evidence only; it must not directly create acceptance.

Return strict JSON with:
{
  "verdict": "accepted|accepted_with_follow_up|rejected|blocked_pending_user_decision",
  "summary": "...",
  "failedRequirements": ["REQ-..."],
  "failedAcceptanceCriteria": ["AC-..."],
  "testsRun": ["..."],
  "evidence": ["..."],
  "followUp": ["..."]
}

## Contract

${contractText}

## qFoundry Task

${JSON.stringify(task, null, 2)}

## Worker Done

${JSON.stringify(workerDone, null, 2)}

## Worker Report

${workerReportText || '(no worker report text found)'}

## Diff

\`\`\`diff
${diffText || '(no diff captured)'}
\`\`\`
`
}

export async function writeReviewReport(projectRoot, task, review, now = new Date()) {
  const reportPath =
    task.reviewReportPath ??
    path.join('.qfoundry', 'reports', `${task.id}-${task.dispatchId ?? 'review'}.md`)
  const absolutePath = path.resolve(projectRoot, reportPath)
  await mkdir(path.dirname(absolutePath), { recursive: true })
  const body = `# qFoundry Verification Report

Task ID: \`${task.id}\`
Orca task ID: \`${task.orcaTaskId ?? 'unknown'}\`
Dispatch ID: \`${task.dispatchId ?? 'unknown'}\`
Verdict: \`${review.verdict}\`
Reviewed at: \`${now.toISOString()}\`

## Summary

${review.summary ?? 'No summary provided.'}

## Failed Requirements

${(review.failedRequirements ?? []).map((item) => `- \`${item}\``).join('\n') || '- none'}

## Failed Acceptance Criteria

${(review.failedAcceptanceCriteria ?? []).map((item) => `- \`${item}\``).join('\n') || '- none'}

## Tests Run

${(review.testsRun ?? []).map((item) => `- ${item}`).join('\n') || '- none recorded'}

## Evidence

${(review.evidence ?? []).map((item) => `- ${item}`).join('\n') || '- none recorded'}

## Follow-Up

${(review.followUp ?? []).map((item) => `- ${item}`).join('\n') || '- none'}
`
  await writeFile(absolutePath, body, 'utf8')
  return reportPath
}

export class CommandReviewer {
  constructor({ command, args = [], env = process.env } = {}) {
    this.command = command
    this.args = args
    this.env = env
  }

  async review(input) {
    if (!this.command) {
      throw new Error('a review command is required for non-test controller runs')
    }
    const prompt = buildReviewPrompt(input)
    const reviewInputPath = path.resolve(
      input.projectRoot,
      REVIEW_INPUT_DIR,
      `${input.task.id}-${input.task.dispatchId ?? 'pending'}.md`
    )
    await mkdir(path.dirname(reviewInputPath), { recursive: true })
    await writeFile(reviewInputPath, prompt, 'utf8')
    const result = await shellCommand(this.command, this.args, {
      cwd: input.projectRoot,
      env: this.env,
      stdin: prompt
    })
    if (result.code !== 0) {
      throw new Error(
        `review command exited ${result.code}: ${result.stderr || result.stdout || 'no output'}`
      )
    }
    try {
      return JSON.parse(result.stdout)
    } catch (error) {
      throw new Error(`review command must print strict JSON: ${error.message}\n${result.stdout}`)
    }
  }
}

export async function readWorkerReport(projectRoot, reportPath) {
  if (!reportPath) {
    return ''
  }
  try {
    return await readFile(path.resolve(projectRoot, reportPath), 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') {
      return ''
    }
    throw error
  }
}
