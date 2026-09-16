// @ts-nocheck
import React from 'react';

// Intentional malformed JSX syntax error: unclosed span tag
export default function BrokenSyntaxFixture() {
  return (
    <div className="p-4 bg-red-100">
      <span className="font-bold">Unclosed span tag
    </div>
  );
}
