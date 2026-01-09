// TypeScript test - SIMPLER VERSION
test('TypeScript test works', () => {
  const result = 1 + 1;  // Remove type annotation for now
  expect(result).toBe(2);
});

test('String test in TypeScript', () => {
  const text = 'hello';  // Remove type annotation for now
  expect(text).toBe('hello');
});

// Test with type annotation separately
test('Type annotation test', () => {
  interface Test {
    value: number;
  }
  
  const obj: Test = { value: 1 };
  expect(obj.value).toBe(1);
});