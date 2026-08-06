---
name: Capability Approval Skill
slug: capability-approval-skill
version: 1.0.0
description: Fixture that requests a scoped network capability.
runtime: instruction-agent
capabilities:
  web.fetch:
    allowedDomains:
      - example.com
    maxCalls: 2
---
# Capability approval
