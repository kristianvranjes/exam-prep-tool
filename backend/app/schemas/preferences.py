from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, StringConstraints, field_validator, model_validator

Palette = Literal["dark", "light", "night", "contrast", "custom"]
Markers = Literal["shapes", "letters"]
Colour = Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")]
# The four sizes the settings screen offers, as multipliers of the base font size.
FONT_SCALES = (0.9, 1.0, 1.15, 1.3)


class CustomColours(BaseModel):
    model_config = ConfigDict(extra="forbid")

    bg: Colour
    text: Colour
    acc: Colour


class Preferences(BaseModel):
    """How one user wants the interface to look; defaults are the dark palette."""

    model_config = ConfigDict(extra="forbid")

    palette: Palette = "dark"
    # Kept when another palette is chosen, so switching back needs no re-entry.
    custom: CustomColours | None = None
    font_scale: float = 1.0
    markers: Markers = "shapes"

    @field_validator("font_scale")
    @classmethod
    def known_scale(cls, value: float) -> float:
        if value not in FONT_SCALES:
            raise ValueError("Use a font scale of 0.9, 1, 1.15 or 1.3")
        return value

    @model_validator(mode="after")
    def custom_needs_colours(self) -> Self:
        if self.palette == "custom" and self.custom is None:
            raise ValueError("Give the custom colours for the custom palette")
        return self
