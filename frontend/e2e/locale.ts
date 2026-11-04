// The interface defaults to Croatian. The journeys below are written against the English
// text, so every browser context starts with the language cookie set to English.
export const english = {
  cookies: [{
    name: "examprep-locale",
    value: "en",
    domain: "localhost",
    path: "/",
    expires: -1,
    httpOnly: false,
    secure: false,
    sameSite: "Lax" as const,
  }],
  origins: [],
};
