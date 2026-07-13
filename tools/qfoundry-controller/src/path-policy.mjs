import path from 'node:path'
import process from 'node:process'

function normalizeResolved(filePath) {
  const resolved = path.resolve(filePath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export function isInsidePath(basePath, candidatePath) {
  const base = normalizeResolved(basePath)
  const candidate = normalizeResolved(candidatePath)
  return candidate === base || candidate.startsWith(`${base}${path.sep}`)
}

export function resolveInside(basePath, candidatePath, label = 'path') {
  if (!candidatePath || typeof candidatePath !== 'string') {
    throw new Error(`${label} must be a non-empty string`)
  }
  const resolved = path.isAbsolute(candidatePath)
    ? path.resolve(candidatePath)
    : path.resolve(basePath, candidatePath)
  if (!isInsidePath(basePath, resolved)) {
    throw new Error(`${label} must stay inside ${basePath}: ${candidatePath}`)
  }
  return resolved
}

export function qfoundryDir(projectRoot) {
  return path.resolve(projectRoot, '.qfoundry')
}

export function resolveQFoundryPath(projectRoot, candidatePath, label = 'qFoundry path') {
  const absolute = path.isAbsolute(candidatePath)
    ? path.resolve(candidatePath)
    : path.resolve(projectRoot, candidatePath)
  const base = qfoundryDir(projectRoot)
  if (!isInsidePath(base, absolute)) {
    throw new Error(`${label} must stay inside project .qfoundry/: ${candidatePath}`)
  }
  return absolute
}

export function relativeToProject(projectRoot, absolutePath) {
  return path
    .relative(path.resolve(projectRoot), path.resolve(absolutePath))
    .replaceAll(path.sep, '/')
}

export function resolveWorktreeCwd(worktreeRoot, candidatePath = '.') {
  return resolveInside(worktreeRoot, candidatePath, 'verification cwd')
}
