import { describe, expect, it } from 'vitest'
import { estimateQueryComplexity, tryEstimateQueryComplexity } from '../src/parser/complexity'

describe('estimateQueryComplexity', () => {
  it('scores scalar leaf fields at one point', () => {
    const cost = estimateQueryComplexity(`{ ok }`)
    expect(cost).toBe(1)
  })

  it('scores object fields higher than scalar leaves', () => {
    const cost = estimateQueryComplexity(`
      query GetOrgMetaData {
        organizations {
          id
          name
        }
      }
    `)

    // organizations (object @ depth 0) = 2
    // id + name (scalars @ depth 1) = 1.5 each -> total 5
    expect(cost).toBe(5)
  })

  it('applies depth multiplier for nested objects', () => {
    const cost = estimateQueryComplexity(`
      {
        organizations {
          channels {
            id
          }
        }
      }
    `)

    expect(cost).toBeGreaterThan(6)
  })

  it('returns null for invalid graphql', () => {
    expect(tryEstimateQueryComplexity('{ not valid')).toBeNull()
  })
})
