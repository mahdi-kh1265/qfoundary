import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { normalizeControllerState } from './state-machine.mjs'

export const DEFAULT_STATE_PATH = path.join('.qfoundry', 'controller-state.json')

export async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') {
      return ''
    }
    throw error
  }
}

export async function loadControllerState(projectRoot, statePath = DEFAULT_STATE_PATH) {
  const absolutePath = path.resolve(projectRoot, statePath)
  const text = await readFile(absolutePath, 'utf8')
  return normalizeControllerState(JSON.parse(text))
}

export async function saveControllerState(projectRoot, state, statePath = DEFAULT_STATE_PATH) {
  const absolutePath = path.resolve(projectRoot, statePath)
  await mkdir(path.dirname(absolutePath), { recursive: true })
  const tempPath = `${absolutePath}.tmp`
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(tempPath, absolutePath)
}

export function resolveProjectPath(projectRoot, candidatePath) {
  return path.resolve(projectRoot, candidatePath)
}
