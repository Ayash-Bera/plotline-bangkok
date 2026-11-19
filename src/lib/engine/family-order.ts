export function orderFamilies<T extends { size: number; levels: number }>(candidates: readonly T[]): T[] {
  if (candidates.length < 2) return [...candidates];
  const [first, second] = candidates;
  if (first.levels === second.levels && Math.abs(first.size - second.size) < 0.01) return [first];
  if (first.size >= second.size && first.levels <= second.levels) return [first, second];
  if (second.size >= first.size && second.levels <= first.levels) return [second, first];
  return [first];
}
