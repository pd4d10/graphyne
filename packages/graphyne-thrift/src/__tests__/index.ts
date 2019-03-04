import path from 'path'
import { GraphqlTypeGenerator } from '../next'
import {
  GraphQLInt,
  GraphQLInputObjectType,
  GraphQLEnumType,
  GraphQLString,
} from 'graphql'

const generator = new GraphqlTypeGenerator({
  basePath: path.resolve(__dirname, 'fixtures'),
})

const add = generator.fromThriftFunction({
  file: 'test.thrift',
  identifier: 'add',
})

test('type', () => {
  expect(add.type).toBe(GraphQLInt)
})

test('description', () => {
  expect(add.description).toBe('add')
})

test('args', () => {
  expect(calculate.args).toBeDefined()

  expect(add.args).toHaveProperty('num1')
  expect(add.args).toHaveProperty('num2')
  expect(add.args!.num1.type).toBe(GraphQLInt)
  expect(add.args!.num2.type).toBe(GraphQLInt)
})

const calculate = generator.fromThriftFunction({
  file: 'test.thrift',
  identifier: 'calculate',
})

test('struct', () => {
  expect(calculate.args).toBeDefined()
  expect(calculate.args).toHaveProperty('w')
  expect(calculate.args!.w.type).toBeInstanceOf(GraphQLInputObjectType)

  const type = calculate.args!.w.type as GraphQLInputObjectType
  const fields = type.getFields()
  expect(fields).toHaveProperty('num1')
  expect(fields).toHaveProperty('num2')
  expect(fields).toHaveProperty('op')
  expect(fields).toHaveProperty('comment')

  expect(fields.num1.type).toBe(GraphQLInt)
  expect(fields.num2.type).toBe(GraphQLInt)
  expect(fields.op.type).toBeInstanceOf(GraphQLEnumType)
  expect(fields.comment.type).toBe(GraphQLString)

  expect(fields.num1.defaultValue).toBe(0)
  expect(fields.op.description).toBe('op')

  const enumType = fields.op.type as GraphQLEnumType
  expect(enumType.getValues()).toEqual([
    { name: 'ADD', description: '', isDeprecated: false, value: 1 },
    { name: 'SUBTRACT', description: '', isDeprecated: false, value: 2 },
    { name: 'MULTIPLY', description: '', isDeprecated: false, value: 3 },
    { name: 'DIVIDE', description: '', isDeprecated: false, value: 4 },
  ])
})
