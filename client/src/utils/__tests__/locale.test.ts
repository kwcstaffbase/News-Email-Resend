import { describe, expect, it } from "vitest";
import { getLocalized } from "../locale.ts";

describe("getLocalized", () => {
  describe("locale resolution", () => {
    it("returns the value for the exact requested locale", () => {
      expect(getLocalized({ en_US: "HR Portal", de_DE: "HR-Portal" }, "de_DE")).toBe("HR-Portal");
    });

    it("returns en_US when the requested locale is absent", () => {
      expect(getLocalized({ en_US: "HR Portal", de_DE: "HR-Portal" }, "fr_FR")).toBe("HR Portal");
    });

    it("returns the explicit fallback locale when the requested locale is absent", () => {
      expect(getLocalized({ de_DE: "HR-Portal", fr_FR: "Portail RH" }, "pl_PL", "fr_FR")).toBe(
        "Portail RH"
      );
    });

    it("falls back to the first available value when locale and en_US are both absent", () => {
      expect(getLocalized({ de_DE: "HR-Portal" }, "fr_FR")).toBe("HR-Portal");
    });

    it("returns empty string for an empty record", () => {
      expect(getLocalized({}, "en_US")).toBe("");
    });

    it("returns empty string for null", () => {
      expect(getLocalized(null, "en_US")).toBe("");
    });

    it("returns empty string for undefined", () => {
      expect(getLocalized(undefined, "en_US")).toBe("");
    });
  });

  describe("fallback chain order", () => {
    it("prefers the requested locale over the explicit fallback", () => {
      expect(getLocalized({ de_DE: "HR-Portal", fr_FR: "Portail RH" }, "de_DE", "fr_FR")).toBe(
        "HR-Portal"
      );
    });

    it("prefers explicit fallback over the first-value fallback", () => {
      const record = { pl_PL: "Portal HR", fr_FR: "Portail RH" };
      // Requested locale es_ES absent → use explicit fallback fr_FR, NOT pl_PL (first value)
      expect(getLocalized(record, "es_ES", "fr_FR")).toBe("Portail RH");
    });

    it("falls back to the first value in insertion order when no explicit fallback is given", () => {
      // getLocalized has no implicit en_US fallback — it returns Object.values(record)[0].
      // de_DE is inserted first here, so it wins over en_US.
      const record = { de_DE: "HR-Portal", en_US: "HR Portal" };
      expect(getLocalized(record, "fr_FR")).toBe("HR-Portal");
    });

    it("en_US wins the first-value fallback when it is inserted first", () => {
      // When en_US is first in the record, it naturally becomes the first-value fallback.
      // Note: callers that want an explicit en_US fallback should pass it as the third argument.
      const record = { en_US: "HR Portal", de_DE: "HR-Portal" };
      expect(getLocalized(record, "fr_FR")).toBe("HR Portal");
    });
  });
});
