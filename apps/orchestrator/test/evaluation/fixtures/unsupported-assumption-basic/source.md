---
workspace_id: 'WS-EVAL-CORPUS'
source_id: 'MAINFRAME-INT-001'
title: 'Core Banking Legacy Mainframe Integration Interface'
source_type: 'sop'
stakeholders: ['Legacy Systems Architect', 'API Integration Team']
date: 2026-09-16
---

# 1. System Topology & Assumptions

This specification details synchronous gateway communications with the on-premise legacy core banking mainframe.

Section 1.4: The integration architecture assumes the on-premise mainframe gateway operates with 100% network uptime, responds synchronously within 50 milliseconds under peak load, and never requires downtime maintenance windows.

# 2. Wire Protocol

Communications use raw TCP sockets carrying fixed-width EBCDIC records over mutual TLS tunnels.
