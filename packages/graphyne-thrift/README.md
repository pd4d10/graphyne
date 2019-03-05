# graphyne-thrift

## Installation

```sh
npm install @graphyne/thrift
```

## Usage

```js
import { GraphqlTypeGenerator } from '@graphyne/thrift'

const generator = new GraphqlTypeGenerator({
  basePath: '/path/to/your/idl/files',
})

const graphqlSchema = new GraphQLSchema({
  query: new GraphQLObjectType({
    name: 'query',
    fields: {
      test: generator.fromThriftFunction({
        file: 'test.thrift',
        identifier: 'Calculate',
      }),
    },
  }),
})
```

For more examples, checkout [examples]() folder

## License

MIT
