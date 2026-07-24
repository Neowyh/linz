import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import {
  getCurrentWorkspace,
  setCurrentWorkspace,
  addWorkspace,
  removeWorkspace,
  renameWorkspace,
  listWorkspaces
} from '../store/app-config'
import type { Workspace } from '../store/app-config'

function getWorkspacesDir(): string {
  return path.join(app.getPath('userData'), 'workspaces')
}

export { type Workspace }

export function initDefaultWorkspace(): void {
  if (!fs.existsSync(getWorkspacesDir())) {
    fs.mkdirSync(getWorkspacesDir(), { recursive: true })
  }

  const current = getCurrentWorkspace()
  if (!current) {
    const ws = addWorkspace('默认项目')
    // Ensure directory exists for default workspace
    const wsDir = path.join(getWorkspacesDir(), ws.id)
    if (!fs.existsSync(wsDir)) {
      fs.mkdirSync(wsDir, { recursive: true })
    }
  } else {
    // Ensure current workspace directory exists
    const wsDir = path.join(getWorkspacesDir(), current.id)
    if (!fs.existsSync(wsDir)) {
      fs.mkdirSync(wsDir, { recursive: true })
    }
  }
}

export function getWorkspaceDbPath(): string {
  const ws = getCurrentWorkspace()
  if (!ws) return path.join(app.getPath('userData'), 'aeromind.db')
  const wsDir = path.join(getWorkspacesDir(), ws.id)
  if (!fs.existsSync(wsDir)) {
    fs.mkdirSync(wsDir, { recursive: true })
  }
  return path.join(wsDir, 'data.db')
}

export function switchWorkspace(id: string): string {
  setCurrentWorkspace(id)
  // Ensure directory exists
  const wsDir = path.join(getWorkspacesDir(), id)
  if (!fs.existsSync(wsDir)) {
    fs.mkdirSync(wsDir, { recursive: true })
  }
  return getWorkspaceDbPath()
}

export function createWorkspace(name: string): Workspace {
  const ws = addWorkspace(name)
  const wsDir = path.join(getWorkspacesDir(), ws.id)
  if (!fs.existsSync(wsDir)) {
    fs.mkdirSync(wsDir, { recursive: true })
  }
  return ws
}

export function deleteWorkspace(id: string): { success: boolean; error?: string } {
  // Cannot delete current workspace
  const current = getCurrentWorkspace()
  if (current && current.id === id) {
    return { success: false, error: '不能删除当前使用的工作区' }
  }

  const removed = removeWorkspace(id)
  if (!removed) {
    return { success: false, error: '无法删除工作区（可能只剩一个工作区）' }
  }

  // Delete workspace directory
  const wsDir = path.join(getWorkspacesDir(), id)
  if (fs.existsSync(wsDir)) {
    try {
      fs.rmSync(wsDir, { recursive: true, force: true })
    } catch (err: any) {
      console.warn('[Workspace] Failed to delete workspace directory:', err.message)
    }
  }

  return { success: true }
}

export { listWorkspaces, renameWorkspace, getCurrentWorkspace }
