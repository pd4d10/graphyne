import fs from 'fs'
import path from 'path'
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
import { GraphqlInt64, GraphqlSet, GraphqlMap, Options } from './types'
const { createClient } = require('@thrift/client')

let rpcClient: any

type Dict<T> = {
  [key: string]: T
}

const astMapping: Dict<ThriftDocument> = {}
const identifierCountDict = {} as Dict<number>
const identifierDict = {} as Dict<GraphQLType>

function getFullName(name: string, file: string, isInput = false) {
  return file + '#' + name + (isInput ? '#input' : '')
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

function convertEnumType(node: EnumDefinition, file: string, isInput: boolean) {
  const fullName = getFullName(node.name.value, file, isInput)

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

function convertListType(node: ListType, namespace: string, isInput: boolean) {
  return new GraphQLList(convert(node.valueType, namespace, isInput))
}

function convertMapType() {
  return GraphqlMap
}

function convertSetType() {
  return GraphqlSet
}

function convertStruct(node: StructDefinition, file: string, isInput: boolean) {
  const fullName = getFullName(node.name.value, file, isInput)

  const params = {
    name: getAlias(node.name.value),
    description: commentsToDescription(node.comments),
    fields: () =>
      node.fields.length
        ? node.fields.reduce(
            (dict, field) => {
              dict[field.name.value] = {
                type: convert(field, file, isInput) as any,
                description: commentsToDescription(field.comments),
              }
              return dict
            },
            // {} as Dict<GraphQLFieldConfig<any, any>>,
            {} as Dict<any>,
          )
        : { _: { type: GraphQLBoolean } },
  }

  if (!identifierDict[fullName]) {
    identifierDict[fullName] = isInput
      ? new GraphQLInputObjectType(params)
      : new GraphQLObjectType(params)
  }

  return identifierDict[fullName]
}

function findIdentifier(
  identifier: Identifier,
  file: string,
  isInput: boolean,
) {
  let validFile = file
  let identifierName = identifier.value

  // identifier could be in other file
  if (identifier.value.includes('.')) {
    const strs = identifier.value.split('.')
    if (strs.length > 2) {
      throw new Error('Invalid identifier: ' + identifier.value)
    }

    const includeDefs = astMapping[file].body.filter(
      item =>
        item.type === SyntaxType.IncludeDefinition &&
        item.path.value.endsWith(strs[0] + '.thrift'),
    ) as IncludeDefinition[]

    if (includeDefs.length !== 1) {
      throw new Error('Invalid include definition count: ' + includeDefs.length)
    }

    validFile = path.resolve(path.dirname(file), includeDefs[0].path.value)
    identifierName = strs[1]
  }

  const node = astMapping[validFile].body.find(
    item =>
      (item.type === SyntaxType.StructDefinition ||
        item.type === SyntaxType.EnumDefinition) &&
      item.name.value === identifierName,
  ) as StructDefinition | EnumDefinition

  if (!node) {
    throw new Error("can't find identifier: " + identifierName)
  }
  return convert(node, validFile, isInput)
}

function convertField(field: FieldDefinition, file: string, isInput: boolean) {
  let type = convert(field.fieldType as Node, file, isInput)
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

function convert(node: Node, file: string, isInput: boolean): GraphQLType {
  switch (node.type) {
    case SyntaxType.StructDefinition:
      return convertStruct(node, file, isInput)
    case SyntaxType.FieldDefinition:
      return convertField(node, file, isInput)
    case SyntaxType.EnumDefinition:
      return convertEnumType(node, file, isInput)
    case SyntaxType.ListType:
      return convertListType(node, file, isInput)
    case SyntaxType.MapType:
      return convertMapType()
    case SyntaxType.SetType:
      return convertSetType()
    case SyntaxType.Identifier:
      return findIdentifier(node, file, isInput)

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
  services: serviceMapping,
  getQueryName = (service, func) => service + '_' + func,
}: Options): GraphQLSchema {
  const services = Object.entries(serviceMapping).map(
    ([serviceName, { file, consul, funcs }]) => {
      loadThriftFile(file)
      const ast = astMapping[file]

      // find the first one
      const serviceDef = ast.body.find(
        statement => statement.type === SyntaxType.ServiceDefinition,
      ) as ServiceDefinition

      if (!serviceDef) {
        throw new Error('no service at file: ' + file)
      }

      return { serviceDef, serviceName, file, consul, funcs }
    },
  )

  rpcClient = createClient({
    idl: '/',
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
        (dict, { serviceDef, serviceName, file, funcs = {} }) => {
          serviceDef.functions.forEach(funcDef => {
            if (strict && !funcs[funcDef.name.value]) {
              return dict
            }

            const queryName = getQueryName(
              serviceDef.name.value,
              funcDef.name.value,
            )

            // TODO: fix types
            dict[queryName] = {
              type: convert(
                funcDef.returnType as Node,
                file,
                false,
              ) as GraphQLOutputType,
              description: commentsToDescription(funcDef.comments),
              args: funcDef.fields.reduce(
                (dict, field) => {
                  dict[field.name.value] = {
                    type: convert(
                      field.fieldType as Node,
                      file,
                      true,
                    ) as GraphQLInputType,
                    description: commentsToDescription(field.comments),
                  }
                  return dict
                },
                {} as GraphQLFieldConfigArgumentMap,
              ),
              resolve: async (source, args, ctx, info) => {
                const funcName = funcDef.name.value
                const options = funcs[funcName]

                if (options && options.onRequest) {
                  args.req = await options.onRequest(args.req, ctx)
                }

                let response = rpcClient[serviceName][funcName](args.req)
                if (options && options.onResponse) {
                  response = await options.onResponse(response, ctx)
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
