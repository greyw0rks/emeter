import { expect, it } from "vitest";
import { demo } from "../lib/models";

it("formats token amounts without converting large integers to floating point", () => {
  expect(demo("9007199254740993123456")).toBe("9,007,199,254,740,993.123456");
  expect(demo("1")).toBe("0.000001");
  expect(demo("50000")).toBe("0.05");
  expect(demo("1000000")).toBe("1");
});
