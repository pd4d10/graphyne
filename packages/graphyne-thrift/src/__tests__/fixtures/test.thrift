// https://github.com/apache/thrift/blob/master/tutorial/tutorial.thrift
// with some tweak

enum Operation {
  ADD = 1,
  SUBTRACT = 2,
  MULTIPLY = 3,
  DIVIDE = 4
}

// work
struct Work {
  1: i32 num1 = 0,
  2: i32 num2,
  // op
  3: Operation op,
  4: optional string comment,
}

service Calculator {
  // ping
  void ping(),

  // add
  i32 add(1:i32 num1, 2:i32 num2),

  // calculate
  i32 calculate(1:i32 logid, 2:Work w) throws (1:InvalidOperation ouch),
}
