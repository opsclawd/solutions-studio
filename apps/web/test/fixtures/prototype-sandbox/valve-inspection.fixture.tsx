import React, { useState } from 'react';

/**
 * Valve Inspection Form Fixture:
 * Implements synthetic business rule derived from Solutions Studio PRD (INT-004):
 * - Entity: Secondary Line Valve Inspection
 * - Rule: valve_pressure_psi safe operating range is [450.0 - 850.0] PSI.
 * - Out-of-bounds inputs trigger immediate visual validation warning.
 */
export default function ValveInspectionFixture() {
  const [pressure, setPressure] = useState<string>('650');
  const [status, setStatus] = useState<string>('DRAFT');
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);

  const numPressure = parseFloat(pressure);
  const isValidNumber = !isNaN(numPressure);
  const isOutOfRange = isValidNumber && (numPressure < 450.0 || numPressure > 850.0);
  const isSafe = isValidNumber && !isOutOfRange;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSafe) {
      setStatus('SUBMITTED');
      setIsSubmitted(true);
    }
  };

  return (
    <div className="p-6 max-w-md mx-auto bg-white rounded-xl shadow-md space-y-4 border border-gray-200">
      <div className="flex items-center justify-between border-b pb-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900" data-testid="form-title">
            Valve Inspection & Pressure Check
          </h2>
          <span className="text-xs text-gray-400 font-mono">INT-004 / WS-OPS-001</span>
        </div>
        <span
          data-testid="status-badge"
          className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
            status === 'SUBMITTED'
              ? 'bg-green-100 text-green-700'
              : 'bg-gray-100 text-gray-700'
          }`}
        >
          {status}
        </span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="pressure-input"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Valve Pressure (PSI)
          </label>
          <input
            id="pressure-input"
            data-testid="pressure-input"
            type="number"
            step="0.1"
            value={pressure}
            onChange={(e) => {
              setPressure(e.target.value);
              setIsSubmitted(false);
            }}
            className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 ${
              isOutOfRange
                ? 'border-red-500 focus:ring-red-500 bg-red-50'
                : 'border-gray-300 focus:ring-blue-500'
            }`}
          />
          <p className="mt-1 text-xs text-gray-500">
            Mandatory operating range: 450.0 - 850.0 PSI
          </p>
        </div>

        {/* Dynamic Business Rule Validation Alerts */}
        {isOutOfRange && (
          <div
            data-testid="validation-warning"
            className="p-3 bg-red-50 border border-red-300 rounded-md text-red-700 text-xs flex items-center gap-2"
          >
            <span className="font-bold">CRITICAL:</span>
            <span>
              Valve pressure {numPressure} PSI is outside safe operating range (450.0 - 850.0 PSI).
            </span>
          </div>
        )}

        {isSafe && (
          <div
            data-testid="validation-success"
            className="p-3 bg-green-50 border border-green-300 rounded-md text-green-700 text-xs flex items-center gap-2"
          >
            <span className="font-bold">NORMAL:</span>
            <span>Valve pressure is within safe operating parameters.</span>
          </div>
        )}

        {isSubmitted && (
          <div
            data-testid="submit-confirmation"
            className="p-3 bg-blue-50 border border-blue-300 rounded-md text-blue-700 text-xs"
          >
            Inspection report successfully submitted to field operations log.
          </div>
        )}

        <button
          type="submit"
          data-testid="submit-btn"
          disabled={!isSafe}
          onClick={handleSubmit}
          className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-md shadow transition"
        >
          Submit Inspection Record
        </button>
      </form>
    </div>
  );
}
