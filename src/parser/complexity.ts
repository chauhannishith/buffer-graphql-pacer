import { Kind, parse, type FieldNode } from 'graphql'

export type ComplexityEstimatorOptions = {
  scalarPoints?: number
  objectPoints?: number
  depthMultiplier?: number
}

const DEFAULT_SCALAR_POINTS = 1
const DEFAULT_OBJECT_POINTS = 2
const DEFAULT_DEPTH_MULTIPLIER = 1.5

const fieldPoints = (
  field: FieldNode,
  depth: number,
  options: ComplexityEstimatorOptions,
): number => {
  const scalarPoints = options.scalarPoints ?? DEFAULT_SCALAR_POINTS
  const objectPoints = options.objectPoints ?? DEFAULT_OBJECT_POINTS
  const depthMultiplier = options.depthMultiplier ?? DEFAULT_DEPTH_MULTIPLIER

  const basePoints = field.selectionSet ? objectPoints : scalarPoints
  const multiplier = depth <= 0 ? 1 : depthMultiplier ** depth
  return basePoints * multiplier
}

/**
 * Estimate Buffer-style GraphQL query complexity from a query string.
 * Uses AST parsing (conservative; may differ slightly from server scoring).
 */
export const estimateQueryComplexity = (
  source: string,
  options: ComplexityEstimatorOptions = {},
): number => {
  const document = parse(source)
  let total = 0

  for (const definition of document.definitions) {
    if (definition.kind !== Kind.OPERATION_DEFINITION || !definition.selectionSet) {
      continue
    }

    const walk = (fields: readonly FieldNode[], fieldDepth: number): void => {
      for (const field of fields) {
        total += fieldPoints(field, fieldDepth, options)
        if (field.selectionSet) {
          walk(field.selectionSet.selections.filter(isFieldNode), fieldDepth + 1)
        }
      }
    }

    walk(definition.selectionSet.selections.filter(isFieldNode), 0)
  }

  return Math.ceil(total)
}

export const tryEstimateQueryComplexity = (
  source: string,
  options: ComplexityEstimatorOptions = {},
): number | null => {
  try {
    return estimateQueryComplexity(source, options)
  } catch {
    return null
  }
}

const isFieldNode = (node: { kind: string }): node is FieldNode => node.kind === Kind.FIELD
