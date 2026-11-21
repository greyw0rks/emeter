import { POLICY_V1_GATES } from "@emeter/circuit";

export const signalPositions: Record<number, [number, number]> = {
  2: [-5, 2.4], 3: [-5, 1.5], 4: [-5, .5], 5: [-5, -.4], 6: [-5, -1.4], 7: [-5, -2.3],
  8: [-3.4, -1.4], 9: [-3.4, -2.3], 10: [-1.2, -1.85],
  11: [-3.4, 1.95], 12: [-1.8, 1.95], 13: [-3.4, .05], 14: [-1.8, .05],
  15: [-.1, 1.05], 16: [1.45, 1.05], 17: [3.05, .05], 18: [4.6, .05]
};
export function circuitSignals(mask: number) {
  const values = [false, true, ...Array.from({ length: 6 }, (_, bit) => Boolean(mask & (1 << bit)))];
  for (const [a, b] of POLICY_V1_GATES) values.push(!(values[a]! && values[b]!));
  return values;
}
export const circuitWires = POLICY_V1_GATES.flatMap(([a, b], index) =>
  Array.from(new Set([a, b]), source => ({ source, target: index + 8 })));
