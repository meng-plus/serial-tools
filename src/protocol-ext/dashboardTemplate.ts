/** 实例面板默认控件模板生成：ui.dashboard 模板优先，否则按 role 智能默认 */

import type { DashboardControl, ProtocolManifest } from './types'

/**
 * 生成某实例的面板控件列表。
 * - manifest.ui.dashboard 存在 → 直接作为模板（注册表控件带 grid 声明）。
 * - 否则按 role 生成默认：master → register_grid（可写值）+ 动作按钮行；
 *   slave → register_grid（可编辑）；passive → 变量表 + 动作按钮行。
 */
export function buildPanelControls(manifest: ProtocolManifest): DashboardControl[] {
  if (Array.isArray(manifest.ui.dashboard) && manifest.ui.dashboard.length > 0) {
    return manifest.ui.dashboard.map((c, i) => ({
      ...c,
      id: c.id || `ctl-${i}`,
    }))
  }
  return buildDefaultControls(manifest)
}

/** 按 role 生成默认控件（无 ui.dashboard 模板时的兜底） */
export function buildDefaultControls(manifest: ProtocolManifest): DashboardControl[] {
  const controls: DashboardControl[] = []
  const actions = manifest.ui.actions || []
  const tableParam = (manifest.ui.params || []).find(p => p.type === 'table')

  if (manifest.role === 'master') {
    controls.push({
      id: 'ctl-registers',
      type: 'register_grid',
      row: 0,
      col: 0,
      w: 12,
      h: 8,
      title: '寄存器',
      grid: {
        label: '寄存器',
        paramKey: tableParam?.key,
        editable: true,
        writeAction: tableParam?.key === 'poll' ? 'write_reg' : undefined,
        writeArgs: { addr: '{addr}', value: '{value}' },
      },
    })
  } else if (manifest.role === 'slave') {
    controls.push({
      id: 'ctl-registers',
      type: 'register_grid',
      row: 0,
      col: 0,
      w: 12,
      h: 8,
      title: '寄存器 / 线圈',
      grid: {
        label: '寄存器 / 线圈',
        paramKey: tableParam?.key,
        editable: true,
        writeAction: 'set_value',
        writeArgs: { kind: '{row.kind}', addr: '{addr}', value: '{value}' },
      },
    })
  } else {
    // passive：变量网格（无 paramKey 时自动用实例 variables）
    controls.push({
      id: 'ctl-variables',
      type: 'register_grid',
      row: 0,
      col: 0,
      w: 12,
      h: 6,
      title: '变量',
      grid: {
        label: '变量',
        editable: false,
      },
    })
  }

  // 动作按钮行（有动作时）
  if (actions.length > 0) {
    const baseRow = controls.reduce((m, c) => Math.max(m, c.row + c.h), 0)
    actions.forEach((a, i) => {
      controls.push({
        id: `ctl-action-${a.id}`,
        type: 'button',
        row: baseRow,
        col: i * 2,
        w: 2,
        h: 2,
        title: a.label,
        actionId: a.id,
        actionParams: {},
      })
    })
  }
  return controls
}

export default buildPanelControls