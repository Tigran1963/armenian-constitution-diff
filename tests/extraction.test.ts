import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('PDF extraction quality', () => {
  it('flags incomplete, corrupted or OCR-derived extractions without replacing uncertain text', () => {
    expect(() => execFileSync('python3', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_extract.py'], {
      stdio: 'pipe',
    })).not.toThrow()
  })
})
