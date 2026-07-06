## Operator Plan

- Preserve PyTorch layer norm semantics for shape normalization and epsilon handling.
- Cover singleton dimensions, broadcastable scale and bias, and dtype-sensitive edge cases.
- Keep correctness fixes separate from performance tuning.
