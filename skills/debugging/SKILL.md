---
name: debugging
description: Diagnose failures through reproduce, isolate, hypothesize, instrument, fix, and regression-test.
---

## Debugging Framework

Use this when the user reports a bug, exception, broken behavior, failed test, or regression.

1. Reproduce or capture the failing signal.
2. Minimize the case until the failure boundary is clear.
3. Form one or two hypotheses tied to evidence.
4. Add targeted instrumentation or inspect the relevant code path.
5. Fix the smallest responsible cause.
6. Run the narrow regression test first, then broader tests if the affected surface is shared.
7. Summarize the root cause, fix, and residual risk.
