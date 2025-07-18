import React from 'react';
import { renderToReadableStream } from 'react-dom/server.edge';

const promise1 = Promise.resolve('value1');
const promise2 = Promise.resolve('value2');

function Component1() {
  const data = React.use(promise1);
  console.log('Component1 React.use result:', data);
  return React.createElement(
    'div',
    null,
    `Component1: ${data}`,
    React.createElement(Component2Lazy),
  );
}

const Component2Lazy = React.lazy(async () => ({ default: Component2 }));

function Component2() {
  const data = React.use(promise2);
  console.log('Component2 React.use result:', data);
  return React.createElement('div', null, `Component2: ${data}`);
}

function App() {
  return React.createElement('div', null, React.createElement(Component1));
}

console.log('=== React SSR use() collision test ===');

async function test() {
  try {
    const stream = await renderToReadableStream(React.createElement(App));
    const reader = stream.getReader();
    let html = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      html += new TextDecoder().decode(value);
    }

    console.log('HTML output:', html);
  } catch (error) {
    console.error('Error:', error);
  }
}

test();
