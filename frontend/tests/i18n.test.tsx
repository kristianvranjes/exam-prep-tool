import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LanguageSelect, LocaleProvider, translate, useT } from "../src/lib/i18n";
import { DEFAULT_LOCALE, LOCALE_COOKIE, parseLocale } from "../src/lib/locale";
import { hr } from "../src/lib/messages/hr";

function Greeting() {
  const t = useT();
  return <p>{t("Open course: {name}", { name: "PPJ" })} · {t("Log in")} · {t("Not translated yet")}</p>;
}

describe("translations", () => {
  it("fills placeholders and falls back to the English text", () => {
    expect(translate("Open course: {name}", { name: "SRS" }, "hr")).toBe("Otvori kolegij: SRS");
    expect(translate("Open course: {name}", { name: "SRS" }, "en")).toBe("Open course: SRS");
    expect(translate("Something new", undefined, "hr")).toBe("Something new");
  });

  it("keeps every placeholder of the English key in the Croatian text", () => {
    for (const [english, croatian] of Object.entries(hr)) {
      const wanted = (english.match(/\{\w+\}/g) ?? []).sort();
      expect((croatian.match(/\{\w+\}/g) ?? []).sort(), english).toEqual(wanted);
    }
  });

  it("defaults to Croatian and accepts only known languages", () => {
    expect(DEFAULT_LOCALE).toBe("hr");
    expect(parseLocale(undefined)).toBe("hr");
    expect(parseLocale("en")).toBe("en");
    expect(parseLocale("de")).toBe("hr");
  });

  it("switches the language, remembers it in a cookie and sets the page language", () => {
    render(<LocaleProvider initial="hr"><LanguageSelect /><Greeting /></LocaleProvider>);
    expect(screen.getByText("Otvori kolegij: PPJ · Prijavi se · Not translated yet")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("hr");

    fireEvent.change(screen.getByLabelText("Jezik"), { target: { value: "en" } });
    expect(screen.getByText("Open course: PPJ · Log in · Not translated yet")).toBeInTheDocument();
    expect(screen.getByLabelText("Language")).toHaveValue("en");
    expect(document.cookie).toContain(`${LOCALE_COOKIE}=en`);
    expect(document.documentElement.lang).toBe("en");
  });

  it("stays English without a provider, as in component tests", () => {
    render(<Greeting />);
    expect(screen.getByText("Open course: PPJ · Log in · Not translated yet")).toBeInTheDocument();
  });
});
