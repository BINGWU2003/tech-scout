import { researchStages, type ResearchStage } from './research-stage'

type ResearchLocation = { stage: ResearchStage; runId: string }

function storageKey(userId: string, projectId: string) {
  return `research-location-v1:${userId}:${projectId}`
}

export function readResearchLocation(
  userId: string | undefined,
  projectId: string
) {
  if (!userId) return null
  try {
    const value = JSON.parse(
      localStorage.getItem(storageKey(userId, projectId)) ?? 'null'
    )
    if (
      value &&
      Object.prototype.hasOwnProperty.call(researchStages, value.stage) &&
      typeof value.runId === 'string' &&
      value.runId.length > 0
    )
      return value as ResearchLocation
  } catch {
    // 浏览器禁用存储或记录损坏时，按当前研究进度打开。
  }
  return null
}

export function saveResearchLocation(
  userId: string | undefined,
  projectId: string,
  location: ResearchLocation
) {
  if (!userId) return
  try {
    localStorage.setItem(
      storageKey(userId, projectId),
      JSON.stringify(location)
    )
  } catch {
    // 存储不可用不应阻止正常浏览。
  }
}
