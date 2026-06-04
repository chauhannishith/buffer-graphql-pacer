import { describe, expect, it } from 'vitest'
import { PACKAGE_NAME } from '../src/index'

describe('package scaffold', () => {
  it('exports the package identifier', () => {
    expect(PACKAGE_NAME).toBe('buffer-graphql-pacer')
  })
})
