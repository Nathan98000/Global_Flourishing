"""Hand-written JSON Schema for data/catalog.json (emitted alongside it)."""

from __future__ import annotations

from typing import Any

from ..overrides import DIRECTIONS, FAMILIES, REVIEW_STATUSES, SCALE_TYPES, SFI_DOMAINS

_WAVE = {"type": "string", "enum": ["Y1", "MY", "Y2"]}
_NULLABLE_INT = {"type": ["integer", "null"]}
_NULLABLE_STR = {"type": ["string", "null"]}


def catalog_json_schema() -> dict[str, Any]:
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://github.com/Nathan98000/Global_Flourishing/data/catalog.schema.json",
        "title": "Flourish Atlas variable catalog",
        "type": "object",
        "required": ["meta", "variables", "value_labels", "countries", "aliases"],
        "additionalProperties": False,
        "properties": {
            "meta": {
                "type": "object",
                "required": ["generated_by", "source_pdf", "waves"],
                "properties": {
                    "generated_by": {"type": "string"},
                    "source_pdf": {"type": "string"},
                    "waves": {"type": "array", "items": _WAVE},
                },
            },
            "variables": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": [
                        "name",
                        "display_name",
                        "label",
                        "wording",
                        "section",
                        "family",
                        "scale_type",
                        "direction",
                        "min",
                        "max",
                        "waves_available",
                        "is_country_specific",
                        "is_us_only",
                        "sfi_domain",
                        "nonresponse_codes",
                        "restricted",
                        "review_status",
                        "source_pages",
                        "codebook_headings",
                    ],
                    "additionalProperties": False,
                    "properties": {
                        "name": {"type": "string"},
                        "display_name": {"type": "string"},
                        "label": _NULLABLE_STR,
                        "wording": _NULLABLE_STR,
                        "section": _NULLABLE_STR,
                        "family": {"type": "string", "enum": sorted(FAMILIES)},
                        "scale_type": {"type": "string", "enum": sorted(SCALE_TYPES)},
                        "direction": {"type": "string", "enum": sorted(DIRECTIONS)},
                        "min": _NULLABLE_INT,
                        "max": _NULLABLE_INT,
                        "waves_available": {"type": "array", "items": _WAVE},
                        "is_country_specific": {"type": "boolean"},
                        "is_us_only": {"type": "boolean"},
                        "sfi_domain": {
                            "type": ["string", "null"],
                            "enum": [*sorted(SFI_DOMAINS), None],
                        },
                        "nonresponse_codes": {
                            "type": "object",
                            "required": ["skipped", "dk", "refused"],
                            "additionalProperties": False,
                            "properties": {
                                "skipped": {"type": "array", "items": {"type": "integer"}},
                                "dk": {"type": "array", "items": {"type": "integer"}},
                                "refused": {"type": "array", "items": {"type": "integer"}},
                            },
                        },
                        "restricted": {"type": "boolean"},
                        "review_status": {"type": "string", "enum": sorted(REVIEW_STATUSES)},
                        "source_pages": {
                            "type": ["array", "null"],
                            "items": {"type": "integer"},
                            "minItems": 2,
                            "maxItems": 2,
                        },
                        "codebook_headings": {"type": "array", "items": {"type": "string"}},
                        "notes": _NULLABLE_STR,
                    },
                },
            },
            "value_labels": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": [
                        "variable",
                        "wave",
                        "country_code",
                        "code",
                        "label",
                        "is_nonresponse",
                    ],
                    "additionalProperties": False,
                    "properties": {
                        "variable": {"type": "string"},
                        "wave": {"type": ["string", "null"], "enum": ["Y1", "MY", "Y2", None]},
                        "country_code": _NULLABLE_INT,
                        "code": {"type": "integer"},
                        "label": {"type": "string"},
                        "is_nonresponse": {"type": "boolean"},
                    },
                },
            },
            "countries": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["code", "name", "iso3"],
                    "additionalProperties": False,
                    "properties": {
                        "code": {"type": "integer"},
                        "name": {"type": "string"},
                        "iso3": {"type": "string", "pattern": "^[A-Z]{3}$"},
                    },
                },
            },
            "aliases": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["heading", "variable", "variable_label", "pages"],
                    "additionalProperties": False,
                    "properties": {
                        "heading": {"type": "string"},
                        "variable": {"type": "string"},
                        "variable_label": _NULLABLE_STR,
                        "pages": {
                            "type": "array",
                            "items": {"type": "integer"},
                            "minItems": 2,
                            "maxItems": 2,
                        },
                    },
                },
            },
        },
    }
