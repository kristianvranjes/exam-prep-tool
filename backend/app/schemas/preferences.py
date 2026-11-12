from datetime import datetime
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Palette = Literal["dark", "light", "night", "contrast", "custom", "system"]
FontScalePercent = Literal[90, 100, 115, 130]
AnswerMarkers = Literal["letters", "shapes"]

HEX_COLOR = r"^#[0-9a-fA-F]{6}$"


class CustomColors(BaseModel):
    """The three pickers of the custom palette, as #rrggbb."""

    model_config = ConfigDict(extra="forbid")

    background: str = Field(pattern=HEX_COLOR)
    text: str = Field(pattern=HEX_COLOR)
    accent: str = Field(pattern=HEX_COLOR)

    @field_validator("background", "text", "accent")
    @classmethod
    def lower(cls, value: str) -> str:
        return value.lower()


class PreferencesBody(BaseModel):
    """The whole preferences document; a PUT replaces it."""

    model_config = ConfigDict(extra="forbid")

    palette: Palette
    font_scale_percent: FontScalePercent
    answer_markers: AnswerMarkers
    # Kept even while another palette is active, so switching back restores the colours.
    custom_colors: CustomColors | None = None

    @model_validator(mode="after")
    def custom_palette_needs_colors(self) -> Self:
        if self.palette == "custom" and self.custom_colors is None:
            raise ValueError("The custom palette needs custom_colors")
        return self


class PreferencesResponse(PreferencesBody):
    # Null while the user has never saved preferences and the defaults apply.
    updated_at: datetime | None = None


DEFAULT_PREFERENCES = PreferencesResponse(
    palette="dark", font_scale_percent=100, answer_markers="letters", custom_colors=None
)
