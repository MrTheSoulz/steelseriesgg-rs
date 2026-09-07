import { it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { Range } from "../src/Range";
it("returns to the confirmed value when a rejected commit finishes", () => {
  const { getByRole, rerender } = render(<Range label="Gain" value={0.7} onCommit={() => {}} />);
  const slider = getByRole("slider");
  fireEvent.change(slider, { target: { value: "0.2" } });
  fireEvent.keyUp(slider, { key: "ArrowDown" });
  rerender(<Range label="Gain" value={0.7} disabled onCommit={() => {}} />);
  rerender(<Range label="Gain" value={0.7} onCommit={() => {}} />);
  expect(slider).toHaveValue("0.7");
});
