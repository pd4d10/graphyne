import { GraphQLScalarType, Kind } from 'graphql'

export interface OnRequestExtra {
  context: any
  service: string
  method: string
}

export interface OnResponseExtra extends OnRequestExtra {
  request: any
}

export interface TypeNameOptions {
  file: string
  name: string
  isEnum: boolean
  isInput: boolean
}

export interface Options {
  strict?: boolean
  getQueryName?: (serviceName: string, funcName: string) => string
  getTypeName?: (options: TypeNameOptions) => string
  idlPath: string
  convertEnumToInt?: boolean
  services: {
    [serviceName: string]: {
      file: string
      consul: string
      servers?: string[]
      methods?: {
        [funcName: string]: {
          onRequest?: (request: any, extra: OnRequestExtra) => Promise<any>
          onResponse?: (response: any, extra: OnResponseExtra) => Promise<any>
        }
      }
    }
  }
  globalHooks?: {
    onRequest?: (request: any, extra: OnRequestExtra) => Promise<any>
    onResponse?: (response: any, extra: OnResponseExtra) => Promise<any>
  }
}

export const GraphqlInt64 = new GraphQLScalarType({
  name: 'Int64',
  description: 'Use string or number',
  serialize: value => {
    if (value.toStringSigned) {
      return value.toStringSigned()
    }
    return value.toString()
  },
  parseValue: value => {
    return value
  },
  parseLiteral(ast) {
    switch (ast.kind) {
      case Kind.INT:
      case Kind.STRING:
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
    const result: { [key: string]: any } = {}
    value.forEach((k, v) => {
      result[k] = serializeScalar(v)
    })
    return result
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
