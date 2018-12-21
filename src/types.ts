import { GraphQLScalarType, Kind } from 'graphql'

export const GraphqlInt64 = new GraphQLScalarType({
  name: 'Int64',
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

export const GraphqlMap = new GraphQLScalarType({
  name: 'Map',
  serialize: value => {
    if (value instanceof Map) {
      return [...value].reduce((result, [k, v]) => {
        result[k] = v
        return result
      }, {})
    }

    return value
  },
})

export const GraphqlSet = new GraphQLScalarType({
  name: 'Set',
  serialize: value => {
    if (value instanceof Set) {
      return [...value]
    }
    return value
  },
})
