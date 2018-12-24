import { GraphQLScalarType, Kind, GraphQLResolveInfo } from 'graphql'

export type ResolveFunc = (
  source: any,
  args: any,
  ctx: any,
  info: GraphQLResolveInfo,
  serviceName: string,
  funcName: string,
) => any

export const GraphqlInt64 = new GraphQLScalarType({
  name: 'Int64',
  description: 'Use string or number',
  serialize: value => {
    return value.toString()
  },
  parseValue: value => {
    return value
  },
  parseLiteral(ast) {
    switch (ast.kind) {
      case Kind.INT:
        return ast.value
      default:
        throw new Error('kind should be int, get: ' + ast.kind)
    }
  },
})

// serialize function for map and set
// these data structures can be nested
function serializeScalar(value: any): any {
  if (value instanceof Set) {
    return [...value].map(serializeScalar)
  }

  if (value instanceof Map) {
    return [...value].reduce(
      (result, [k, v]) => {
        // for key, call toString by default
        result[k] = serializeScalar(v)
        return result
      },
      {} as { [key: string]: any },
    )
  }

  return value
}

export const GraphqlMap = new GraphQLScalarType({
  name: 'Map',
  description: 'Use plain object',
  serialize: serializeScalar,
})

export const GraphqlSet = new GraphQLScalarType({
  name: 'Set',
  description: 'Use Array',
  serialize: serializeScalar,
})
