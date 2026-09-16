import React from 'react';

// Intentional runtime render exception
export default function RuntimeErrorFixture() {
  throw new Error('Synthetic render failure inside sandboxed prototype component.');
  return <div>Will never render</div>;
}
