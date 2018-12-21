import graphqlHttp from 'express-graphql'
import { thriftToSchema } from './graphql'

export function middleware(files: string[], resolveFunc: Function) {
  return graphqlHttp({
    schema: thriftToSchema(files, resolveFunc),
    graphiql: true,
  })
}
