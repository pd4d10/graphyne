import { Middleware } from 'koa'
const graphqlHttp = require('koa-graphql') // TODO: types
import { thriftToSchema } from './graphql'
import { ResolveFunc } from './types'

export function createMiddleware(
  files: string[],
  resolveFunc: ResolveFunc,
  options: any,
): Middleware {
  return graphqlHttp({
    ...options,
    schema: thriftToSchema(files, resolveFunc),
  })
}
