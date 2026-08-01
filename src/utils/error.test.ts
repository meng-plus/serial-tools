import { describe, it, expect } from 'vitest'
import { parseCommandError, errorMessage, UNKNOWN_ERROR } from './error'

describe('parseCommandError', () => {
  it('解析结构化 { code, message }', () => {
    expect(parseCommandError({ code: 'channel_not_found', message: '通道 serial-COM1 不存在' })).toEqual({
      code: 'channel_not_found',
      message: '通道 serial-COM1 不存在',
    })
  })

  it('message 缺失时回退到 String(e)', () => {
    expect(parseCommandError({ code: 'transport' })).toEqual({
      code: 'transport',
      message: '[object Object]',
    })
  })

  it('Error 实例归为 unknown', () => {
    expect(parseCommandError(new Error('boom'))).toEqual({ code: 'unknown', message: 'boom' })
  })

  it('字符串兜底', () => {
    expect(parseCommandError('plain string')).toEqual({ code: 'unknown', message: 'plain string' })
  })

  it('null/undefined 返回 UNKNOWN_ERROR', () => {
    expect(parseCommandError(null)).toBe(UNKNOWN_ERROR)
    expect(parseCommandError(undefined)).toBe(UNKNOWN_ERROR)
  })

  it('errorMessage 返回中文消息', () => {
    expect(errorMessage({ code: 'send_failed', message: '发送失败: x' })).toBe('发送失败: x')
  })
})
