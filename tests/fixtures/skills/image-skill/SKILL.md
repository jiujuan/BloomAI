---
name: Image Skill
slug: image-skill
version: 1.0.0
description: Fixture for deterministic image capability flows.
runtime: instruction-agent
capabilities:
  image.generate:
    allowedModels:
      - deterministic-image-model
    maxCalls: 1
recommended_surface: image-studio
output_artifacts:
  - markdown
  - image-reference
---
# Image skill
