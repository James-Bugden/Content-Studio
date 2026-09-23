---
name: qa-regression
description: Apply T0–T4 verification, exact bug retests, browser/UX QA and continuous campaign rules.
---
# QA and regression
T0 = static/unit/integration/build/schema. T1 = deterministic Playwright.
T2 = agentic browser/UX, responsive, states, accessibility, console/network.
T3 = simulator/emulator for mobile-sensitive behavior. T4 = physical
browser/device for native behavior. Retest the exact original defect in the
exposing environment where practical. Skipped/blocked/inconclusive/advisory-red/
never-started is not a pass. Keep unrelated QA moving while fix agents work.
Record build identity, environment, expected vs actual, commands and evidence.