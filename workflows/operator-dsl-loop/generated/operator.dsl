operator layer_norm(input, weight, bias, epsilon) {
  mean = reduce_mean(input)
  centered = input - mean
  variance = reduce_mean(centered * centered)
  normalized = centered / sqrt(variance + epsilon)
  return normalized * weight + bias
}
