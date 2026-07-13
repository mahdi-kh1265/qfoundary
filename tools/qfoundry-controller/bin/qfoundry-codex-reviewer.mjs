#!/usr/bin/env node
import process from 'node:process'

import { launchCodexReviewer } from '../src/codex-reviewer-launcher.mjs'

function argValue(args, name, fallback = undefined) {
  const prefix = `--${name}=`
  const inline = args.find((arg) => arg.startsWith(prefix))
  if (inline) {
    return inline.slice(prefix.length)
  }
  const index = args.indexOf(`--${name}`)
  if (index !== -1) {
    return args[index + 1] ?? fallback
  }
  return fallback
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function main() {
  const args = process.argv.slice(2)
  const projectRoot = argValue(args, 'project') ?? process.cwd()
  const timeoutMs = Number(argValue(args, 'timeout-ms', '180000'))
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive integer')
  }
  const result = await launchCodexReviewer({
    projectRoot,
    reviewInput: await readStdin(),
    codexCommand: argValue(args, 'codex'),
    timeoutMs
  })
  process.stdout.write(`${JSON.stringify(result.review, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`)
  process.exit(1)
})
