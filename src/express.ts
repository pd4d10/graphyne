import { RequestHandler } from 'express'
import graphqlHttp from 'express-graphql'
import { thriftToSchema } from './graphql'
import { Options } from './types'

export function createMiddleware(
  services: Options['services'],
  resolveFunc: Options['resolveFunc'],
  options: graphqlHttp.Options,
): RequestHandler {
  return graphqlHttp({
    ...options,
    schema: thriftToSchema({ services, resolveFunc }),
  })
}
