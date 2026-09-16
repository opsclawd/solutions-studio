---
workspace_id: 'WS-EVAL-CORPUS'
source_id: 'ORG-MODEL-001'
title: 'Enterprise Billing Entity Relationship Schema'
source_type: 'schema'
stakeholders: ['Data Architecture Guild', 'Billing Services']
date: 2026-09-16
---

# 1. Schema Scope

This schema defines the hierarchical relationship between enterprise parent organizations, subsidiary accounts, and billing instruments.

# 2. Entity Relations

Section 2.1: An Enterprise Customer may attach multiple billing profiles to an organization, and each billing profile may contain multiple authorized corporate credit cards.

# 3. Currency Support

All billing profiles must identify a primary settlement currency conforming to ISO 4217.
