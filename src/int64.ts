import { GraphQLScalarType, Kind } from 'graphql'

export const Int64 = new GraphQLScalarType({
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
