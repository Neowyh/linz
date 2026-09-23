import type { WorkspaceService, WorkspaceListSnapshot, WorkspaceItem } from './types'
import { ReactiveSnapshot } from './reactive-snapshot'
import { getConversationsRepo } from '../database'

/**
 * Implements `ctx.workspaces` for the DSH Cordis shim.
 *
 * Groups conversations by their `cwd` (working directory) into workspaces,
 * mirroring DSH's workspace model. Conversations without a cwd are grouped
 * under an "未分组" (ungrouped) workspace.
 */
export class WorkspaceServiceImpl implements WorkspaceService {
  readonly list: ReactiveSnapshot<WorkspaceListSnapshot>

  constructor() {
    this.list = new ReactiveSnapshot<WorkspaceListSnapshot>({ items: [] })
    this.refresh()
  }

  refresh(): void {
    const repo = getConversationsRepo()
    const conversations = repo.list(9999)
    const groups = new Map<string, WorkspaceItem>()

    for (const conv of conversations) {
      const cwd = conv.cwd
      const key = cwd && cwd.trim() !== '' ? cwd : '__ungrouped__'
      let group = groups.get(key)
      if (!group) {
        const title = key === '__ungrouped__' ? '未分组' : cwd!.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? cwd!
        group = {
          workspaceId: key,
          title,
          path: key === '__ungrouped__' ? null : cwd!,
          sessionIds: []
        }
        groups.set(key, group)
      }
      group.sessionIds.push(conv.id)
    }

    this.list.setSnapshot({ items: [...groups.values()] })
  }
}
