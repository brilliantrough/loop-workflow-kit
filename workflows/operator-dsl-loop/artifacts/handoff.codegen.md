# Plan Handoff For Codegen

The plan stage selected a layer normalization operator because the run input points at `reference/layer_norm.py` and requests `generated/operator.dsl`.

Codegen should preserve PyTorch-visible semantics first. Focus on normalized-shape behavior, epsilon stability, and broadcasted weight and bias. Use `artifacts/plan-output.md` for the narrative plan and `artifacts/plan-summary.json` for the compact checklist.

Do not redesign the workflow or create a new prompt for later stages. Produce the required codegen outputs only: `generated/operator.dsl` and `artifacts/codegen-report.md`.
