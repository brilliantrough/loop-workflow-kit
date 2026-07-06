# Operator Rules

- Preserve PyTorch-visible semantics before optimizing generated DSL code.
- Do not change tensor shape behavior or epsilon semantics without updating the plan.
- Keep correctness and performance evidence in separate artifacts.
- When a correctness gate fails, prefer the smallest repair that keeps the original operator strategy intact.
