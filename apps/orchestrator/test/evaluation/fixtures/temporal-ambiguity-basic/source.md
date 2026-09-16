---
workspace_id: 'WS-EVAL-CORPUS'
source_id: 'LEDGER-SPEC-001'
title: 'Merchant Balance Settlement and General Ledger Sync Specification'
source_type: 'sop'
stakeholders: ['Treasury Operations', 'Core Settlement Engineering']
date: 2026-09-16
---

# 1. Purpose & Core Accounts

This document specifies the reconciliation and settlement sync mechanism between the payment gateway and the corporate general ledger.

# 2. Transaction Ingestion

All card and ACH authorizations are queued in the ingestion ledger upon gateway confirmation.

# 3. Settlement Processing

Section 4.2: The reconciliation worker runs periodically throughout the day to settle merchant balances, and updates the external ledger after a while once settlement batches are ready.
