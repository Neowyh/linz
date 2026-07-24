import { getRoster } from '../layout/officeLayout'

/** Spine Chibi Stickers 可用皮肤（9 套，超出按 index 循环复用） */
export const CHIBI_CHARACTER_SKINS = [
  'misaki',
  'erikari',
  'nate',
  'harri',
  'luke',
  'soeren',
  'mario',
  'sinisa',
  'spineboy',
] as const

/** 动态名册下的皮肤映射：按 Agent 在名册中的序号循环取皮 */
export function getChibiSkinName(agentId: string): string {
  const list = getRoster()
  const idx = list.findIndex((a) => a.id === agentId)
  if (idx < 0) return 'spineboy'
  return CHIBI_CHARACTER_SKINS[idx % CHIBI_CHARACTER_SKINS.length]
}
