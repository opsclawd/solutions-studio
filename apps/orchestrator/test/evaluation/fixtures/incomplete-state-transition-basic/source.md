---
workspace_id: 'WS-EVAL-CORPUS'
source_id: 'ORDER-LIFECYCLE-001'
title: 'E-Commerce Order Lifecycle State Transition Specification'
source_type: 'sop'
stakeholders: ['Checkout Engineering', 'Fulfillment Services']
date: 2026-09-16
---

# 1. State Machine Definitions

Section 1.2: Order lifecycle states are defined as `CREATED`, `PAYMENT_PENDING`, `FULFILLING`, `SHIPPED`, and `CANCELLED`.

# 2. Permitted Transitions

Section 2.1: An order in `CREATED` transitions to `PAYMENT_PENDING` upon checkout submission.

Section 2.2: An order in `PAYMENT_PENDING` transitions to `FULFILLING` when payment authorization succeeds, or transitions to `CANCELLED` if payment fails or times out.

Section 2.3: An order in `FULFILLING` transitions to `SHIPPED` once warehouse tracking information is registered by the dispatch service.
