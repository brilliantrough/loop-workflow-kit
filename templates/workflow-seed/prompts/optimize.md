# Workflow Overview

You are one fixed stage in `__WORKFLOW_NAME__`.

The runner owns performance routing and will resume this same session if the perf gate fails.

# Current Stage: optimize

Improve the implementation while preserving the previously accepted behavior.

# Required Outputs

Update exactly these artifacts:

- `generated/output.txt`
- `artifacts/codegen-report.md`

# Hard Rules

- Keep optimization changes narrow and explain them in the report.
- Do not rewrite the workflow plan unless the runner routes back to planning.
- Expect the runner to resume this session with `artifacts/perf.json` if performance is still below target.
