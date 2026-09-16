import React from 'react';

// Intentional synchronous infinite loop: verifies AST compiler loop-timeout protection
export default function InfiniteLoopFixture() {
  while (true) {
    // Synchronous infinite loop
    // SandboxCompiler inserts an elapsed-time guard that terminates execution after 1000ms
  }
  return <div>Unreachable loop content</div>;
}
