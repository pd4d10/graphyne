import fs from 'fs'
import path from 'path'
import assert from 'assert'
import {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLString,
  GraphQLInputObjectType,
  GraphQLInt,
  GraphQLFieldConfig,
  GraphQLBoolean,
  GraphQLInputFieldConfig,
  GraphQLNonNull,
  GraphQLEnumType,
  GraphQLEnumValueConfigMap,
  GraphQLType,
  GraphQLOutputType,
  GraphQLInputType,
  GraphQLList,
  GraphQLFieldConfigArgumentMap,
} from 'graphql'
import {
  parse,
  ThriftDocument,
  SyntaxType,
  StructDefinition,
  Identifier,
  ServiceDefinition,
  Comment,
  FieldDefinition,
  IncludeDefinition,
  EnumDefinition,
  MapType,
  ListType,
  SetType,
  BaseType,
} from '@creditkarma/thrift-parser'
import {
  GraphqlInt64,
  GraphqlSet,
  GraphqlMap,
  Options,
  onRequestExtra,
  onResponseExtra,
} from './types'
const { createClient } = require('thrift-client')
let rpcClient: any

type Dict<T> = {
  [key: string]: T
}

const astMapping: Dict<ThriftDocument> = {}
const identifierCountDict = {} as Dict<number>
const identifierDict = {} as Dict<GraphQLType>

function getFullName(name: string, options: ConvertOptions) {
  return options.file + '#' + name + (options.isInput ? '#input' : '')
}

function getAlias(name: string) {
  if (typeof identifierCountDict[name] === 'undefined') {
    identifierCountDict[name] = 0
    return name
  } else {
    identifierCountDict[name]++
    return name + identifierCountDict[name]
  }
}

function loadThriftFile(file: string) {
  if (astMapping[file]) {
    console.log(file + ' already loaded, skipping...')
    return astMapping[file]
  }

  const ast = parse(fs.readFileSync(file, 'utf8'))
  if (ast.type === SyntaxType.ThriftErrors) {
    console.error(ast.errors)
    throw new Error('Thrift IDL parse error: ' + file)
  }

  astMapping[file] = ast

  // load include files
  const includeDefs = ast.body.filter(
    statement => statement.type === SyntaxType.IncludeDefinition,
  ) as IncludeDefinition[]
  includeDefs.forEach(includeDef => {
    loadThriftFile(path.resolve(path.dirname(file), includeDef.path.value))
  })
}

function commentsToDescription(comments: Comment[]) {
  return comments.reduce((comment, { value }) => {
    return comment + value
  }, '')
}

function convertEnumType(node: EnumDefinition, options: ConvertOptions) {
  const fullName = getFullName(node.name.value, options)

  if (options.convertEnumToInt) {
    return GraphQLInt
  }

  if (!identifierDict[fullName]) {
    identifierDict[fullName] = new GraphQLEnumType({
      name: getAlias(node.name.value),
      description: commentsToDescription(node.comments),
      values: node.members.reduce(
        (dict, member, index) => {
          dict[member.name.value] = {
            value: member.initializer
              ? parseInt(
                  member.initializer.value.value,
                  member.initializer.value.type === SyntaxType.HexLiteral
                    ? 16
                    : 10,
                )
              : index,
            description: commentsToDescription(member.comments),
          }
          return dict
        },
        {} as GraphQLEnumValueConfigMap,
      ),
    })
  }

  return identifierDict[fullName]
}

function convertListType(node: ListType, options: ConvertOptions) {
  return new GraphQLList(convert(node.valueType, options))
}

function convertMapType() {
  return GraphqlMap
}

function convertSetType() {
  return GraphqlSet
}

function convertStruct(node: StructDefinition, options: ConvertOptions) {
  const fullName = getFullName(node.name.value, options)

  const params = {
    name: getAlias(node.name.value),
    description: commentsToDescription(node.comments),
    fields: () =>
      node.fields.length
        ? node.fields.reduce(
            (dict, field) => {
              dict[field.name.value] = {
                type: convert(field, options) as any,
                description: commentsToDescription(field.comments),
              }
              return dict
            },
            // {} as Dict<GraphQLFieldConfig<any, any>>,
            {} as Dict<any>,
          )
        : {
            _: {
              type: GraphQLBoolean,
              description: 'This is just a placeholder',
            },
          },
  }

  if (!identifierDict[fullName]) {
    identifierDict[fullName] = options.isInput
      ? new GraphQLInputObjectType(params)
      : new GraphQLObjectType(params)
  }

  return identifierDict[fullName]
}

function findIdentifier(identifier: Identifier, options: ConvertOptions) {
  let file = options.file
  let identifierName = identifier.value

  // identifier could be in other file
  if (identifier.value.includes('.')) {
    const strs = identifier.value.split('.')

    // expect `{namespace}.{identifier}` pattern
    assert.equal(strs.length, 2, 'Invalid identifier: ' + identifier.value)

    const fileName = strs[0] + '.thrift'
    const includeDefs = astMapping[options.file].body.filter(
      item =>
        item.type === SyntaxType.IncludeDefinition &&
        (item.path.value === fileName ||
          item.path.value.endsWith('/' + fileName)),
    ) as IncludeDefinition[]

    // expect 1 include path match `{namespace}.thrift`
    assert.equal(
      includeDefs.length,
      1,
      'Invalid include definition count: ' + includeDefs.length,
    )

    file = path.resolve(path.dirname(options.file), includeDefs[0].path.value)
    identifierName = strs[1]
  }

  const node = astMapping[file].body.find(
    item =>
      (item.type === SyntaxType.StructDefinition ||
        item.type === SyntaxType.EnumDefinition) &&
      item.name.value === identifierName,
  ) as StructDefinition | EnumDefinition

  assert(node, "can't find identifier: " + identifierName)
  return convert(node, { ...options, file })
}

function convertField(field: FieldDefinition, options: ConvertOptions) {
  let type = convert(field.fieldType as Node, options)
  if (field.requiredness === 'required') {
    type = GraphQLNonNull(type)
  }
  return type
}

type Node =
  | StructDefinition
  | FieldDefinition
  | EnumDefinition
  | ListType
  | MapType
  | SetType
  | Identifier
  | BaseType

interface ConvertOptions {
  file: string
  isInput: boolean
  convertEnumToInt: boolean
}

function convert(node: Node, options: ConvertOptions): GraphQLType {
  switch (node.type) {
    case SyntaxType.StructDefinition:
      return convertStruct(node, options)
    case SyntaxType.FieldDefinition:
      return convertField(node, options)
    case SyntaxType.EnumDefinition:
      return convertEnumType(node, options)
    case SyntaxType.ListType:
      return convertListType(node, options)
    case SyntaxType.MapType:
      return convertMapType()
    case SyntaxType.SetType:
      return convertSetType()
    case SyntaxType.Identifier:
      return findIdentifier(node, options)

    // base type
    case SyntaxType.I8Keyword:
    case SyntaxType.I16Keyword:
    case SyntaxType.I32Keyword:
    case SyntaxType.BinaryKeyword:
    case SyntaxType.ByteKeyword:
    case SyntaxType.DoubleKeyword:
      return GraphQLInt
    case SyntaxType.I64Keyword:
      return GraphqlInt64
    case SyntaxType.StringKeyword:
      return GraphQLString
    case SyntaxType.BoolKeyword:
      return GraphQLBoolean

    default:
      console.log(node)
      throw new Error('node type error')
  }
}

export function thriftToSchema({
  strict = true,
  idlPath,
  convertEnumToInt = false,
  globalHooks = {},
  services: serviceMapping,
  getQueryName = (service, func) => service + '_' + func,
}: Options): GraphQLSchema {
  const services = Object.entries(serviceMapping).map(
    ([serviceName, { file: fileRelative, consul, methods }]) => {
      const file = path.resolve(idlPath, fileRelative)
      loadThriftFile(file)
      const ast = astMapping[file]

      // find the first one
      const serviceDef = ast.body.find(
        statement => statement.type === SyntaxType.ServiceDefinition,
      ) as ServiceDefinition

      assert(serviceDef, 'no service at file: ' + file)

      return { serviceDef, serviceName, file, consul, methods }
    },
  )

  rpcClient = createClient({
    idl: idlPath,
    services: services.reduce(
      (dict, { serviceName, file, consul }) => {
        dict[serviceName] = {
          filename: file,
          consul,
        }
        return dict
      },
      {} as Dict<any>,
    ),
  })

  return new GraphQLSchema({
    query: new GraphQLObjectType({
      name: 'Query',
      description: 'The root query',
      fields: services.reduce(
        (dict, { serviceDef, serviceName, file, methods = {} }) => {
          serviceDef.functions.forEach(funcDef => {
            if (strict && !methods[funcDef.name.value]) {
              return dict
            }

            const queryName = getQueryName(
              serviceDef.name.value,
              funcDef.name.value,
            )

            // TODO: fix types
            dict[queryName] = {
              type: convert(funcDef.returnType as Node, {
                file,
                convertEnumToInt,
                isInput: false,
              }) as GraphQLOutputType,
              description: commentsToDescription(funcDef.comments),
              args: funcDef.fields.reduce(
                (dict, field) => {
                  dict[field.name.value] = {
                    type: convert(field.fieldType as Node, {
                      file,
                      convertEnumToInt,
                      isInput: true,
                    }) as GraphQLInputType,
                    description: commentsToDescription(field.comments),
                  }
                  return dict
                },
                {} as GraphQLFieldConfigArgumentMap,
              ),
              resolve: async (source, args, ctx, info) => {
                const funcName = funcDef.name.value
                const options = methods[funcName] || {}
                // TODO: multiple arguments
                let request = args.req

                const reqExtra: onRequestExtra = {
                  context: ctx,
                  service: serviceName,
                  method: funcName,
                }
                if (globalHooks.onRequest) {
                  request = await globalHooks.onRequest(request, reqExtra)
                }
                if (options.onRequest) {
                  request = await options.onRequest(request, reqExtra)
                }

                let response = await rpcClient[serviceName][funcName](request)

                const resExtra: onResponseExtra = { ...reqExtra, request }
                if (globalHooks.onResponse) {
                  response = await globalHooks.onResponse(response, resExtra)
                }
                if (options.onResponse) {
                  response = await options.onResponse(response, resExtra)
                }

                return response
              },
            }
          })

          return dict
        },
        {} as Dict<GraphQLFieldConfig<any, any>>,
      ),
    }),
  })
}
