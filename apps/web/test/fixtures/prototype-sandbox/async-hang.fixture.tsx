import React from 'react';

// Intentional async hang: suspends indefinitely to verify host timeout recovery and iframe teardown
export default function AsyncHangFixture() {
  throw new Promise(() => {});
  return <div>Hanging component</div>;
}
