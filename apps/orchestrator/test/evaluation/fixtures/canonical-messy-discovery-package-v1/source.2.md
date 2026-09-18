---
workspace_id: 'WS-EVAL-CORPUS'
source_id: 'CORE-SOP-001'
title: 'Integrated Operations Core Procedure (Revision 2)'
source_type: 'sop'
stakeholders: ['Operations Steering Committee', 'Executive Leadership']
date: 2026-06-15
---

# 1. Operational Scope

This procedure supersedes Revision 1 and establishes comprehensive rules for procurement, contractor governance, emergency interventions, telemetry state lifecycles, and notification reliability.

# 2. Executive Purchase Sign-Off

Section 2.1: Purchase commitments exceeding $50,000 require CEO sign-off before contract execution.

# 3. Contractor Access Governance

Section 3.1: Contractor access duration is capped at 30 days before credential revalidation is required by the hiring manager.

# 4. Emergency Intervention Controls

Section 4.1: Any console operator may execute the 'Emergency Factory Shutdown' routine without entering secondary administrative credentials.

# 5. Supplementary Procurement Rules

Section 5.4: Corporate purchases up to $100,000 may be authorized by the Operations Director without CEO sign-off; CEO sign-off is required only for commitments exceeding $100,000 before contract execution.

# 6. Batch Telemetry Processing

Section 6.2: Batch telemetry ingestion lifecycle states are defined as `QUEUED`, `PROCESSING`, and `COMPLETED`. When `PROCESSING` is underway, records are transformed sequentially until all entries are written.

# 7. Safety Alert Dispatches

Section 7.3: Outbound SMS alerts for safety warnings are dispatched via external telco gateway HTTP POST endpoint upon incident trigger.

# 8. Archival Maintenance

Section 8.1: Archival table compression executes periodically whenever host memory usage appears low.

# 9. Entity Tagging

Section 9.1: An organization account may attach multiple data retention tags and multiple regulatory classifications to its metadata profile.

# 10. External Ingestion Pipeline

Section 10.2: The high-throughput ingestion pipeline assumes the external geocoding provider has infinite queries per second with 0% dropped connections.

# 11. Support Service Level Agreements

Section 11.1: Silver Support tier customers receive initial incident response within 24 business hours of ticket creation.

Section 11.2: Gold Support tier customers receive initial incident response within 4 business hours of ticket creation.
