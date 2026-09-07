import { it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
afterEach(cleanup);
import { Range } from "../src/Range";
it("keeps disabled observed controls synchronized", () => {
  const { getByRole, rerender } = render(<Range label="Read-only" value={0.7} disabled onCommit={() => {}} />);
  rerender(<Range label="Read-only" value={0.2} disabled onCommit={() => {}} />);
  expect(getByRole("slider", { name: "Read-only" })).toHaveValue("0.2");
  expect(getByRole("slider", { name: "Read-only" })).toHaveAttribute("aria-valuetext", "20 percent");
});
it("returns to the confirmed value when a rejected commit finishes", () => {
  const { getByRole, rerender } = render(<Range label="Gain" value={0.7} onCommit={() => {}} />);
  const slider = getByRole("slider");
  fireEvent.change(slider, { target: { value: "0.2" } });
  fireEvent.keyUp(slider, { key: "ArrowDown" });
  rerender(<Range label="Gain" value={0.7} disabled onCommit={() => {}} />);
  rerender(<Range label="Gain" value={0.7} onCommit={() => {}} />);
  expect(slider).toHaveValue("0.7");
});
