import { RequestHandler } from 'express'
import graphqlHttp from 'express-graphql'
import { thriftToSchema } from './graphql'
import { ResolveFunc } from './types'

export function createMiddleware(
  files: string[],
  resolveFunc: ResolveFunc,
  options: graphqlHttp.Options,
): RequestHandler {
  return graphqlHttp({
    ...options,
    schema: thriftToSchema(files, resolveFunc),
  })
}
