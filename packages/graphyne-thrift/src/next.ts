import fs from 'fs'
import assert from 'assert'
import path from 'path'
import {
  parse,
  ThriftDocument,
  SyntaxType,
  IncludeDefinition,
  ServiceDefinition,
  StructDefinition,
  FunctionDefinition,
  FieldDefinition,
  EnumDefinition,
  ListType,
  MapType,
  SetType,
  Identifier,
  BaseType,
  FunctionType,
  ConstValue,
} from '@creditkarma/thrift-parser'
import {
  GraphQLOutputType,
  GraphQLFieldConfigArgumentMap,
  GraphQLType,
  GraphQLNonNull,
  GraphQLFloat,
  GraphQLString,
  GraphQLBoolean,
  GraphQLInt,
  GraphQLEnumType,
  GraphQLEnumValueConfigMap,
  GraphQLList,
  GraphQLInputType,
  GraphQLInputObjectType,
  GraphQLObjectType,
  GraphQLInputFieldConfig,
  GraphQLFieldConfig,
} from 'graphql'
import { commentsToDescription } from './utils'
import { GraphqlInt64, GraphqlMap, GraphqlSet } from './types'

type MyNode =
  | StructDefinition
  | FieldDefinition
  | EnumDefinition
  | ListType
  | MapType
  | SetType
  | Identifier
  | BaseType
  | FunctionType

interface Dict<T> {
  [key: string]: T
}

interface ConvertOptions {
  file: string
  isInput: boolean
}

export interface GraphqlTypeGeneratorOptions {
  basePath: string
  /**
   * Convert Thrift Enum to GraphQL int
   */
  convertEnumToInt?: boolean
}

export class GraphqlTypeGenerator {
  private astMapping: Dict<ThriftDocument> = {}
  private enumDict: Dict<GraphQLEnumType> = {}
  private inputObjectDict: Dict<GraphQLInputObjectType> = {}
  private objectDict: Dict<GraphQLObjectType> = {}

  private basePath: string
  private convertEnumToInt = false

  constructor({ basePath, convertEnumToInt }: GraphqlTypeGeneratorOptions) {
    this.basePath = basePath
    if (typeof convertEnumToInt !== 'undefined') {
      this.convertEnumToInt = convertEnumToInt
    }
  }

  private loadThriftFile(file: string) {
    if (this.astMapping[file]) {
      console.log(file + ' already loaded, skipping...')
      return
    }

    const ast = parse(
      fs.readFileSync(path.resolve(this.basePath, file), 'utf8'),
    )

    if (ast.type === SyntaxType.ThriftErrors) {
      console.error(ast.errors)
      throw new Error('Thrift IDL parse error: ' + file)
    }

    this.astMapping[file] = ast

    // load include files
    const includeDefs = ast.body.filter(
      statement => statement.type === SyntaxType.IncludeDefinition,
    ) as IncludeDefinition[]

    includeDefs.forEach(includeDef => {
      this.loadThriftFile(path.join(path.dirname(file), includeDef.path.value))
    })
  }

  private convertConstValue(constValue: ConstValue) {
    switch (constValue.type) {
      case SyntaxType.StringLiteral:
      case SyntaxType.BooleanLiteral:
        return constValue.value
      case SyntaxType.IntConstant:
        return parseInt(
          constValue.value.value,
          constValue.value.type === SyntaxType.HexLiteral ? 16 : 10,
        )
      case SyntaxType.DoubleConstant:
        return parseFloat(constValue.value.value)
      default:
        // TODO:
        return
    }
  }

  private convertEnumType(node: EnumDefinition, options: ConvertOptions) {
    const enumKey = options.file + '#' + node.name.value

    if (this.convertEnumToInt) {
      return GraphQLInt
    }

    if (!this.enumDict[enumKey]) {
      const enumValues: GraphQLEnumValueConfigMap = {}
      node.members.forEach(member => {
        enumValues[member.name.value] = {
          value: member.initializer
            ? this.convertConstValue(member.initializer)
            : undefined,
          description: commentsToDescription(member.comments),
        }
      })

      this.enumDict[enumKey] = new GraphQLEnumType({
        name: node.name.value,
        description: commentsToDescription(node.comments),
        values: enumValues,
      })
    }

    return this.enumDict[enumKey]
  }

  private convertListType(node: ListType, options: ConvertOptions) {
    return new GraphQLList(this.convert(node.valueType, options))
  }

  private convertStruct(node: StructDefinition, options: ConvertOptions) {
    const structKey = options.file + '#' + node.name.value

    if (options.isInput) {
      const structFields: Dict<GraphQLInputFieldConfig> = {}
      if (node.fields.length) {
        node.fields.forEach(field => {
          structFields[field.name.value] = {
            type: this.convert(field, options) as GraphQLInputType,
            description: commentsToDescription(field.comments),
            defaultValue: field.defaultValue
              ? this.convertConstValue(field.defaultValue)
              : undefined,
          }
        })
      } else {
        // TODO: remove this struct?
        structFields._ = {
          type: GraphQLBoolean,
          description: 'This is just a placeholder',
        }
      }

      if (!this.inputObjectDict[structKey]) {
        this.inputObjectDict[structKey] = new GraphQLInputObjectType({
          name: node.name.value + 'Input',
          description: commentsToDescription(node.comments),
          fields: () => structFields,
        })
      }
      return this.inputObjectDict[structKey]
    } else {
      const structFields: Dict<GraphQLFieldConfig<any, any>> = {}
      if (node.fields.length) {
        node.fields.forEach(field => {
          structFields[field.name.value] = {
            type: this.convert(field, options) as GraphQLOutputType,
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

      if (!this.objectDict[structKey]) {
        this.objectDict[structKey] = new GraphQLObjectType({
          // TODO: name conflict
          // options.file.replace(/[\/\.]/g, '_') +
          name: node.name.value,
          description: commentsToDescription(node.comments),
          fields: () => structFields,
        })
      }
      return this.objectDict[structKey]
    }
  }

  private findIdentifier(identifier: Identifier, options: ConvertOptions) {
    let file = options.file
    let identifierName = identifier.value

    // identifier could be in other file
    if (identifier.value.includes('.')) {
      const strs = identifier.value.split('.')

      // expect `{namespace}.{identifier}` pattern
      assert.equal(strs.length, 2, 'Invalid identifier: ' + identifier.value)

      const fileName = strs[0] + '.thrift'
      const includeDefs = this.astMapping[options.file].body.filter(
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

      file = path.join(path.dirname(options.file), includeDefs[0].path.value)
      identifierName = strs[1]
    }

    const node = this.astMapping[file].body.find(
      item =>
        (item.type === SyntaxType.StructDefinition ||
          item.type === SyntaxType.EnumDefinition) &&
        item.name.value === identifierName,
    ) as StructDefinition | EnumDefinition

    assert(node, `identifier not found: ${identifierName} ${options.file}`)
    return this.convert(node, { ...options, file })
  }

  private convertField(field: FieldDefinition, options: ConvertOptions) {
    let type = this.convert(field.fieldType as MyNode, options)
    if (field.requiredness === 'required') {
      type = GraphQLNonNull(type)
    }
    return type
  }

  private convert(node: MyNode, options: ConvertOptions): GraphQLType {
    switch (node.type) {
      case SyntaxType.StructDefinition:
        return this.convertStruct(node, options)
      case SyntaxType.FieldDefinition:
        return this.convertField(node, options)
      case SyntaxType.EnumDefinition:
        return this.convertEnumType(node, options)
      case SyntaxType.ListType:
        return this.convertListType(node, options)
      case SyntaxType.MapType:
        return GraphqlMap
      case SyntaxType.SetType:
        return GraphqlSet
      case SyntaxType.Identifier:
        return this.findIdentifier(node, options)

      // base types
      case SyntaxType.I8Keyword:
      case SyntaxType.I16Keyword:
      case SyntaxType.I32Keyword:
      case SyntaxType.BinaryKeyword:
      case SyntaxType.ByteKeyword:
        return GraphQLInt
      case SyntaxType.I64Keyword:
        return GraphqlInt64
      case SyntaxType.DoubleKeyword:
        return GraphQLFloat
      case SyntaxType.StringKeyword:
        return GraphQLString
      case SyntaxType.BoolKeyword:
        return GraphQLBoolean

      default:
        throw new Error('node type error')
    }
  }

  fromThriftFunction({
    file,
    identifier,
  }: {
    file: string
    identifier: string
  }): GraphQLFieldConfig<any, any> {
    this.loadThriftFile(file)
    const ast = this.astMapping[file]

    const serviceDef = ast.body.find(
      statement => statement.type === SyntaxType.ServiceDefinition,
    ) as ServiceDefinition
    assert(serviceDef, `service not found: ${identifier} at ${file}`)

    const funcDef = serviceDef.functions.find(
      func => func.name.value === identifier,
    ) as FunctionDefinition
    assert(funcDef, `function not found: ${identifier} at ${file}`)

    const queryArgs: GraphQLFieldConfigArgumentMap = {}

    funcDef.fields.forEach(field => {
      queryArgs[field.name.value] = {
        type: this.convert(field.fieldType, {
          file,
          isInput: true,
        }) as GraphQLInputType,
        description: commentsToDescription(field.comments),
      }
    })

    return {
      type: this.convert(funcDef.returnType, {
        file,
        isInput: false,
      }) as GraphQLOutputType,
      description: commentsToDescription(funcDef.comments),
      args: queryArgs,
    }
  }
}
