import React, { useState } from 'react';

export default function CounterFixture() {
  const [count, setCount] = useState(0);

  return (
    <div className="p-6 max-w-sm mx-auto bg-white rounded-xl shadow-md space-y-4 border border-gray-200">
      <h2 className="text-xl font-bold text-gray-900" data-testid="counter-title">
        Interactive Counter
      </h2>
      <p className="text-sm text-gray-500">
        Tests React state transitions inside the sandboxed iframe.
      </p>
      <div className="flex items-center space-x-4">
        <span
          data-testid="counter-value"
          className="text-3xl font-extrabold text-blue-600 w-16 text-center"
        >
          {count}
        </span>
        <button
          data-testid="increment-btn"
          onClick={() => setCount((prev) => prev + 1)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-sm transition"
        >
          Increment
        </button>
        <button
          data-testid="reset-btn"
          onClick={() => setCount(0)}
          className="px-3 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm transition"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
