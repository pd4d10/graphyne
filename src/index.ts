import graphqlHttp from 'express-graphql'
import { thriftToSchema } from './graphql'

export function middleware(file: string, resolveFunc: Function) {
  return graphqlHttp({
    schema: thriftToSchema(file, resolveFunc),
    graphiql: true,
  })
}
