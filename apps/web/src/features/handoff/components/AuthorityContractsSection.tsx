'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import type { AuthorityBundleDto, EngineeringDecisionDto } from '@solutions-studio/contracts';

export interface AuthorityContractsSectionProps {
  readonly baselineId: string;
  readonly authorityBundle: AuthorityBundleDto;
  readonly engineeringDecisions: readonly EngineeringDecisionDto[];
}

export function AuthorityContractsSection({
  baselineId,
  authorityBundle,
  engineeringDecisions
}: AuthorityContractsSectionProps) {
  const [subTab, setSubTab] = useState<'requirements' | 'policies' | 'decisions'>('requirements');

  const { requirements, policyConstraints } = authorityBundle;

  return (
    <div
      data-testid="authority-contracts-section"
      className="bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden"
    >
      {/* Header & Sub-tabs */}
      <div className="border-b border-gray-200 px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <span>Authority Contracts</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-medium">
              Source of Truth
            </span>
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Authoritative baseline requirements, active policy constraints, and baseline engineering
            decisions
          </p>
        </div>

        <div className="flex bg-gray-100 p-1 rounded-lg text-xs font-medium self-start sm:self-auto">
          <button
            type="button"
            data-testid="authority-tab-requirements"
            onClick={() => setSubTab('requirements')}
            className={`px-3 py-1 rounded-md transition ${
              subTab === 'requirements'
                ? 'bg-white text-gray-900 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Requirements ({requirements.length})
          </button>
          <button
            type="button"
            data-testid="authority-tab-policies"
            onClick={() => setSubTab('policies')}
            className={`px-3 py-1 rounded-md transition ${
              subTab === 'policies'
                ? 'bg-white text-gray-900 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Policies ({policyConstraints.length})
          </button>
          <button
            type="button"
            data-testid="authority-tab-decisions"
            onClick={() => setSubTab('decisions')}
            className={`px-3 py-1 rounded-md transition ${
              subTab === 'decisions'
                ? 'bg-white text-gray-900 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Decisions ({engineeringDecisions.length})
          </button>
        </div>
      </div>

      {/* Subtab Contents */}
      <div className="p-6">
        {subTab === 'requirements' && (
          <div className="space-y-3">
            {requirements.length === 0 ? (
              <p className="text-xs text-gray-500 italic">No requirements in this baseline.</p>
            ) : (
              <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
                {requirements.map((req) => (
                  <div
                    key={req.id}
                    data-testid={`authority-item-${req.id}`}
                    className="p-3 bg-white hover:bg-gray-50/60 transition text-xs"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-gray-900">{req.id}</span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold bg-gray-100 text-gray-700">
                          {req.category}
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold bg-blue-50 text-blue-700">
                          Rev {req.revision}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                            req.reviewState === 'ACCEPTED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {req.reviewState}
                        </span>
                        <Link
                          href={`/review?baselineId=${encodeURIComponent(baselineId)}&requirementId=${encodeURIComponent(req.id)}`}
                          className="text-indigo-600 hover:text-indigo-800 font-medium"
                          title="Open in reconciliation review"
                        >
                          Review →
                        </Link>
                      </div>
                    </div>
                    <p className="text-gray-800 leading-relaxed">{req.statement}</p>
                    <div className="mt-2 flex items-center gap-3 text-[11px] text-gray-500">
                      <span>Origin: {req.origin}</span>
                      <span>•</span>
                      <span>Resolution: {req.resolutionState}</span>
                      <span>•</span>
                      <span>Evidence refs: {req.evidence.length}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {subTab === 'policies' && (
          <div className="space-y-3">
            {policyConstraints.length === 0 ? (
              <p className="text-xs text-gray-500 italic">
                No policy constraints attached to this baseline.
              </p>
            ) : (
              <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
                {policyConstraints.map((pol) => (
                  <div
                    key={pol.id}
                    data-testid={`authority-item-${pol.id}`}
                    className="p-3 bg-white text-xs"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-mono font-bold text-gray-900">{pol.id}</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-emerald-100 text-emerald-800">
                        {pol.state}
                      </span>
                    </div>
                    <p className="text-gray-800 leading-relaxed">{pol.statement}</p>
                    {pol.authorityReference && (
                      <p className="text-[11px] text-gray-500 mt-1.5 font-mono">
                        Authority: {pol.authorityReference}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {subTab === 'decisions' && (
          <div className="space-y-3">
            {engineeringDecisions.length === 0 ? (
              <p className="text-xs text-gray-500 italic">
                No engineering decisions recorded for this baseline.
              </p>
            ) : (
              <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
                {engineeringDecisions.map((dec) => (
                  <div
                    key={dec.id}
                    data-testid={`authority-item-${dec.id}`}
                    className="p-3 bg-white text-xs"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-mono font-bold text-gray-900">{dec.id}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                          dec.state === 'ACCEPTED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : dec.state === 'PROPOSED'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {dec.state}
                      </span>
                    </div>
                    <p className="text-gray-800 font-medium">{dec.statement}</p>
                    <p className="text-gray-600 mt-1">{dec.rationale}</p>
                    <div className="mt-2 flex items-center gap-3 text-[11px] text-gray-500">
                      <span>
                        {dec.state === 'ACCEPTED'
                          ? `Accepted by: ${dec.acceptedBy ?? 'lead'}`
                          : `Status: ${dec.state}`}
                      </span>
                      <span>•</span>
                      <span>
                        Requirements: {dec.requirementRevisionIds.join(', ') || 'General'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
