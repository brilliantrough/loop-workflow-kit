import torch


def layer_norm_reference(
    input_tensor: torch.Tensor,
    weight: torch.Tensor,
    bias: torch.Tensor,
    epsilon: float,
) -> torch.Tensor:
    normalized_shape = weight.shape
    return torch.nn.functional.layer_norm(
        input_tensor,
        normalized_shape,
        weight,
        bias,
        epsilon,
    )
