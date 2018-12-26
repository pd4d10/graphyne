import { Middleware } from 'koa'
const graphqlHttp = require('koa-graphql') // TODO: types
import { thriftToSchema } from './graphql'
import { Options } from './types'

export function createMiddleware(
  services: Options['services'],
  resolveFunc: Options['resolveFunc'],
  options: any,
): Middleware {
  return graphqlHttp({
    ...options,
    schema: thriftToSchema({ services, resolveFunc }),
  })
}
