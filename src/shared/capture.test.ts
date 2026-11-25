import { describe, expect, it } from 'vitest'
import { clampCaptureRect } from './capture'

describe('clampCaptureRect', () => {
  it('keeps a rectangle that fits in the content area', () => {
    expect(
      clampCaptureRect({ x: 120, y: 80, width: 900, height: 600 }, 1500, 940)
    ).toEqual({ x: 120, y: 80, width: 900, height: 600 })
  })

  it('clamps negative offsets and oversized dimensions', () => {
    expect(
      clampCaptureRect({ x: -20, y: -10, width: 2000, height: 1200 }, 1500, 940)
    ).toEqual({ x: 0, y: 0, width: 1500, height: 940 })
  })

  it('shrinks a rectangle that starts near the bottom-right corner', () => {
    expect(
      clampCaptureRect({ x: 1400, y: 900, width: 400, height: 300 }, 1500, 940)
    ).toEqual({ x: 1400, y: 900, width: 100, height: 40 })
  })

  it('rounds fractional CSS pixels', () => {
    expect(
      clampCaptureRect({ x: 10.4, y: 20.6, width: 300.5, height: 200.4 }, 1500, 940)
    ).toEqual({ x: 10, y: 21, width: 301, height: 200 })
  })

  it('rejects empty or degenerate content areas', () => {
    expect(clampCaptureRect({ x: 0, y: 0, width: 100, height: 100 }, 0, 0)).toBeNull()
    expect(
      clampCaptureRect({ x: 1500, y: 900, width: 100, height: 100 }, 1500, 940)
    ).toBeNull()
    expect(
      clampCaptureRect({ x: Number.NaN, y: 0, width: 100, height: 100 }, 1500, 940)
    ).toBeNull()
  })
})
