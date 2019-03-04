import { Comment } from '@creditkarma/thrift-parser'
import { GraphqlMap, GraphqlSet } from './types'

export function commentsToDescription(comments: Comment[]) {
  return comments.reduce((comment, { value }) => {
    return comment + value
  }, '')
}

export function convertMapType() {
  return GraphqlMap
}

export function convertSetType() {
  return GraphqlSet
}
