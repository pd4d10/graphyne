import assert from 'assert'
import fs from 'fs'
import path from 'path'
import {
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLEnumValueConfigMap,
  GraphQLFieldConfig,
  GraphQLFieldConfigArgumentMap,
  GraphQLFloat,
  GraphQLInputObjectType,
  GraphQLInputType,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLOutputType,
  GraphQLSchema,
  GraphQLString,
  GraphQLType,
} from 'graphql'
import {
  BaseType,
  Comment,
  EnumDefinition,
  FieldDefinition,
  Identifier,
  IncludeDefinition,
  ListType,
  MapType,
  parse,
  ServiceDefinition,
  SetType,
  StructDefinition,
  SyntaxType,
  ThriftDocument,
} from '@creditkarma/thrift-parser'
import {
  GraphqlInt64,
  GraphqlMap,
  GraphqlSet,
  OnRequestExtra,
  OnResponseExtra,
  Options,
  TypeNameOptions,
} from './types'
import { commentsToDescription, convertMapType, convertSetType } from './utils'

const { createClient } = require('thrift-client')

let rpcClient: any

interface Dict<T> {
  [key: string]: T
}

const astMapping: Dict<ThriftDocument> = {}
const identifierCountDict = {} as Dict<number>
const structDict = {} as Dict<GraphQLType>
const enumDict = {} as Dict<GraphQLType>

function getTypeNameDefault(options: TypeNameOptions) {
  return path.basename(options.file, '.thrift') + '_' + options.name
}

function loadThriftFile(file: string) {
  // console.log('Parsing ' + file);
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

function convertEnumType(node: EnumDefinition, options: ConvertOptions) {
  const enumName = options.file + '#' + node.name.value

  if (options.convertEnumToInt) {
    return GraphQLInt
  }

  if (!enumDict[enumName]) {
    const enumValues: GraphQLEnumValueConfigMap = {}
    node.members.forEach((member, index) => {
      enumValues[member.name.value] = {
        value: member.initializer
          ? parseInt(
              member.initializer.value.value,
              member.initializer.value.type === SyntaxType.HexLiteral ? 16 : 10,
            )
          : index,
        description: commentsToDescription(member.comments),
      }
    })

    enumDict[enumName] = new GraphQLEnumType({
      name: options.getTypeName({
        name: node.name.value,
        file: options.file,
        isInput: options.isInput,
        isEnum: true,
      }),
      description: commentsToDescription(node.comments),
      values: enumValues,
    })
  }

  return enumDict[enumName]
}

function convertListType(node: ListType, options: ConvertOptions) {
  return new GraphQLList(convert(node.valueType, options))
}

function convertStruct(node: StructDefinition, options: ConvertOptions) {
  const fullName =
    options.file + '#' + node.name.value + (options.isInput ? '#input' : '')

  const structFields: Dict<any> = {}
  // {} as Dict<GraphQLFieldConfig<any, any>>,
  if (node.fields.length) {
    node.fields.forEach(field => {
      structFields[field.name.value] = {
        type: convert(field, options) as any,
        description: commentsToDescription(field.comments),
      }
    })
  } else {
    // TODO: remove this struct?
    structFields._ = {
      type: GraphQLBoolean,
      description: 'This is just a placeholder',
    }
  }

  const params = {
    name: options.getTypeName({
      file: options.file,
      name: node.name.value,
      isInput: options.isInput,
      isEnum: false,
    }),
    description: commentsToDescription(node.comments),
    fields: () => structFields,
  }

  if (!structDict[fullName]) {
    structDict[fullName] = options.isInput
      ? new GraphQLInputObjectType(params)
      : new GraphQLObjectType(params)
  }

  return structDict[fullName]
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
  getTypeName: (options: {
    file: string
    name: string
    isEnum: boolean
    isInput: boolean
  }) => string
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
      return GraphQLFloat
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
  getTypeName = getTypeNameDefault,
}: Options): GraphQLSchema {
  const services = Object.entries(serviceMapping).map(
    ([serviceName, { file: fileRelative, consul, servers, methods }]) => {
      const file = path.resolve(idlPath, fileRelative)
      loadThriftFile(file)
      const ast = astMapping[file]

      // find the first one
      const serviceDef = ast.body.find(
        statement => statement.type === SyntaxType.ServiceDefinition,
      ) as ServiceDefinition

      assert(serviceDef, 'no service at file: ' + file)

      return { serviceDef, serviceName, file, consul, servers, methods }
    },
  )

  rpcClient = createClient({
    idl: idlPath,
    services: services.reduce(
      (dict, { serviceName, file, consul, servers }) => {
        dict[serviceName] = {
          filename: file,
          consul,
          servers,
        }
        return dict
      },
      {} as Dict<any>,
    ),
  })

  const queryFields: Dict<GraphQLFieldConfig<any, any>> = {}

  services.forEach(({ serviceDef, serviceName, file, methods = {} }) => {
    serviceDef.functions.forEach(funcDef => {
      if (strict && !methods[funcDef.name.value]) return

      const queryName = getQueryName(serviceDef.name.value, funcDef.name.value)

      const queryArgs: GraphQLFieldConfigArgumentMap = {}
      funcDef.fields.forEach(field => {
        queryArgs[field.name.value] = {
          type: convert(field.fieldType as Node, {
            file,
            convertEnumToInt,
            isInput: true,
            getTypeName: getTypeName,
          }) as GraphQLInputType,
          description: commentsToDescription(field.comments),
        }
      })

      // TODO: fix types
      queryFields[queryName] = {
        type: convert(funcDef.returnType as Node, {
          file,
          convertEnumToInt,
          isInput: false,
          getTypeName: getTypeName,
        }) as GraphQLOutputType,
        description: commentsToDescription(funcDef.comments),
        args: queryArgs,
        resolve: async (source, args, ctx, info) => {
          const funcName = funcDef.name.value
          const options = methods[funcName] || {}
          // TODO: multiple arguments
          let request = args.req

          const reqExtra: OnRequestExtra = {
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

          const resExtra: OnResponseExtra = { ...reqExtra, request }
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
  })

  const schema = new GraphQLSchema({
    query: new GraphQLObjectType({
      name: 'Query',
      description: 'The root query',
      fields: queryFields,
    }),
  })

  return schema
}
