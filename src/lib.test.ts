import { describe, expect, it } from "vitest";
import { folderName, speechText } from "./lib";
describe("speech preparation", () => {
  it("speaks explanations while leaving executable snippets in the transcript", () => {
    const spoken = speechText(
      "Run this:\n```sh\nrm -rf /\n```\nThen inspect **the result**.",
    );
    expect(spoken).not.toContain("rm -rf");
    expect(spoken).toContain("code is in the conversation");
    expect(spoken).toContain("the result");
  });
  it("handles source paths without mixing platform separators", () => {
    expect(folderName("C:\\Source\\coco\\")).toBe("coco");
    expect(folderName("/home/coco")).toBe("coco");
  });
});
