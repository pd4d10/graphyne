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
import { GraphqlInt64, GraphqlSet, GraphqlMap } from './types'

type Dict<T> = {
  [key: string]: T
}

const astMapping: Dict<ThriftDocument> = {}
const fileMapping: Dict<string> = {}
const identifierMapping: Dict<EnumDefinition | StructDefinition> = {}

const typeMapping: Dict<GraphQLEnumType> = {}
const inputTypeMapping: Dict<GraphQLInputType> = {}
const outputTypeMapping: Dict<GraphQLOutputType> = {}

const SPLIT = '__'

function loadThriftAstFromFile(file: string) {
  if (fileMapping[file]) {
    console.log(file + ' already loaded, skipping...')
    return fileMapping[file]
  }

  const ast = parse(fs.readFileSync(file, 'utf8'))
  if (ast.type === SyntaxType.ThriftErrors) {
    console.error(ast.errors)
    throw new Error('thrift file parse error: ' + file)
  }

  // get namespace
  // const namespaceDef = ast.body.find(
  //   statement =>
  //     statement.type === SyntaxType.NamespaceDefinition &&
  //     statement.scope.value === 'go',
  // ) as NamespaceDefinition
  // if (!namespaceDef) {
  //   throw new Error('lack of namespace in file ' + file)
  // }

  // const namespace = namespaceDef.name.value
  const namespace = path.basename(file, '.thrift')
  fileMapping[file] = namespace
  astMapping[namespace] = ast

  ast.body.forEach(statement => {
    switch (statement.type) {
      case SyntaxType.EnumDefinition:
      case SyntaxType.StructDefinition: {
        const identifier = namespace + SPLIT + statement.name.value

        if (identifierMapping[identifier]) {
          // TODO: priority of duplicated identifiers
          console.warn('duplicated identifier: ' + identifier + ' at ' + file)
        }
        identifierMapping[identifier] = statement
        break
      }
    }
  })

  // load include files
  const includeDefs = ast.body.filter(
    statement => statement.type === SyntaxType.IncludeDefinition,
  ) as IncludeDefinition[]
  includeDefs.forEach(includeDef => {
    loadThriftAstFromFile(
      path.resolve(path.dirname(file), includeDef.path.value),
    )
  })

  return namespace
}

function commentsToDescription(comments: Comment[]) {
  return comments.reduce((comment, { value }) => {
    return comment + value
  }, '')
}

function convertEnumType(
  node: EnumDefinition,
  namespace: string,
  isInput: boolean,
) {
  const name = namespace + SPLIT + node.name.value

  if (!typeMapping[name]) {
    typeMapping[name] = new GraphQLEnumType({
      name: name,
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

  return typeMapping[name]
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

function convertStruct(
  struct: StructDefinition,
  namespace: string,
  isInput: boolean,
) {
  const name = namespace + SPLIT + struct.name.value + (isInput ? '_input' : '')

  if (isInput) {
    if (!inputTypeMapping[name]) {
      inputTypeMapping[name] = new GraphQLInputObjectType({
        name,
        description: commentsToDescription(struct.comments),
        fields: () =>
          struct.fields.reduce(
            (dict, field) => {
              dict[field.name.value] = {
                type: convert(field, namespace, isInput) as GraphQLInputType,
                description: commentsToDescription(field.comments),
              }
              return dict
            },
            {} as Dict<GraphQLInputFieldConfig>,
          ),
      })
    }
    return inputTypeMapping[name]
  } else {
    if (!outputTypeMapping[name]) {
      outputTypeMapping[name] = new GraphQLObjectType({
        name,
        description: commentsToDescription(struct.comments),
        fields: () =>
          struct.fields.reduce(
            (dict, field) => {
              dict[field.name.value] = {
                type: convert(field, namespace, isInput) as GraphQLOutputType,
                description: commentsToDescription(field.comments),
              }
              return dict
            },
            {} as Dict<GraphQLFieldConfig<any, any>>,
          ),
      })
    }
    return outputTypeMapping[name]
  }
}

function findIdentifier(
  identifier: Identifier,
  namespace: string,
  isInput: boolean,
) {
  let namespaceOfIdentifier = namespace
  let identifierName = identifier.value

  // other namespace
  if (identifier.value.includes('.')) {
    const arrs = identifier.value.split('.')
    identifierName = arrs.pop() as string
    namespaceOfIdentifier = arrs.join('.')
  }

  const ast = astMapping[namespaceOfIdentifier]
  if (!ast) {
    throw new Error('namespace not found: ' + namespaceOfIdentifier)
  }

  const node = ast.body.find(
    item =>
      (item.type === SyntaxType.StructDefinition ||
        item.type === SyntaxType.EnumDefinition) &&
      item.name.value === identifierName,
  ) as StructDefinition | EnumDefinition
  if (!node) {
    throw new Error(
      "can't find identifier: " +
        identifierName +
        '\nnamespace: ' +
        namespaceOfIdentifier,
    )
  }
  return convert(node, namespaceOfIdentifier, isInput)
}

function convertField(
  field: FieldDefinition,
  namespace: string,
  isInput: boolean,
) {
  let type = convert(field.fieldType, namespace, isInput)
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

function convert(node: Node, namespace: string, isInput: boolean): GraphQLType {
  // console.log(namespace)

  switch (node.type) {
    case SyntaxType.StructDefinition: {
      const name = namespace + SPLIT + node.name.value
      if (!isInput && outputTypeMapping[name]) {
        // console.log(name, outputTypeMapping[name])
        return outputTypeMapping[name]
      }
      return convertStruct(node, namespace, isInput)
    }
    case SyntaxType.FieldDefinition:
      return convertField(node, namespace, isInput)
    case SyntaxType.EnumDefinition:
      return convertEnumType(node, namespace, isInput)
    case SyntaxType.ListType:
      return convertListType(node, namespace, isInput)
    case SyntaxType.MapType:
      return convertMapType()
    case SyntaxType.SetType:
      return convertSetType()
    case SyntaxType.Identifier:
      return findIdentifier(node, namespace, isInput)

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

export function thriftToSchema(
  files: string[],
  resolveFunc: Function,
): GraphQLSchema {
  const services = files.map(file => {
    const namespace = loadThriftAstFromFile(file)
    const ast = astMapping[namespace]

    const service = ast.body.find(
      statement => statement.type === SyntaxType.ServiceDefinition,
    ) as ServiceDefinition

    if (!service) {
      throw new Error('no service at file: ' + file)
    }

    return { service, namespace }
  })

  return new GraphQLSchema({
    query: new GraphQLObjectType({
      name: 'Query',
      description: 'The root query',
      fields: services.reduce(
        (dict, { service, namespace }) => {
          service.functions.forEach(func => {
            dict[func.name.value] = {
              type: convert(func.returnType, namespace, false),
              description: commentsToDescription(func.comments),
              args: func.fields.reduce(
                (dict, field) => {
                  dict[field.name.value] = {
                    type: convert(field.fieldType, namespace, true),
                    description: commentsToDescription(field.comments),
                  }
                  return dict
                },
                {} as GraphQLFieldConfigArgumentMap,
              ),
              resolve: async (source, args, ctx, info) => {
                return resolveFunc(
                  source,
                  args,
                  ctx,
                  info,
                  service.name.value,
                  func.name.value,
                )
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
