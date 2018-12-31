import fs from 'fs'
import path from 'path'
import {
  parse,
  ThriftDocument,
  SyntaxType,
  IncludeDefinition,
} from '@creditkarma/thrift-parser'

type Dict<T> = {
  [key: string]: T
}

export interface ClientOptions {
  [serviceName: string]: {
    ip: string
    file: string
  }
}

function loadAst(files: string[]): Dict<ThriftDocument> {
  const astMapping = {} as Dict<ThriftDocument>

  function loadSingleFileAst(file: string) {
    if (astMapping[file]) {
      console.log(file + ' already loaded, skipping...')
      return
    }

    const ast = parse(fs.readFileSync(file, 'utf8'))
    if (ast.type === SyntaxType.ThriftErrors) {
      throw new Error('parse error')
    }

    astMapping[file] = ast

    const includeDefs = ast.body.filter(
      statement => statement.type === SyntaxType.IncludeDefinition,
    ) as IncludeDefinition[]

    includeDefs.forEach(includeDef => {
      const includeFile = path.resolve(
        path.dirname(file),
        includeDef.path.value,
      )
      loadSingleFileAst(includeFile)
    })
  }

  files.forEach(file => {
    loadSingleFileAst(file)
  })

  return astMapping
}

export function createClient(options: ClientOptions) {
  const client: any = {}
  const astMapping = loadAst(Object.values(options).map(({ file }) => file))

  // TODO:
}
