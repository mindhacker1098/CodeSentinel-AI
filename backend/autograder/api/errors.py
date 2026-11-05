"""Turn pydantic validation errors into one sentence for the UI."""
from __future__ import annotations

from collections.abc import Sequence

from ..db.repo import PW_POLICY

LABELS = {
    "roll_no": "Roll number",
    "new": "Password",
    "password": "Password",
    "old": "Current password",
    "review_status": "Review status",
    "review_note": "Review note",
    "override_grade": "Override grade",
    "override_reason": "Override reason",
    "flag_ids": "Flag list",
    "due_at": "Deadline",
    "opens_at": "Opening time",
    "max_submissions_per_hour": "Submissions per hour",
    "page_size": "Page size",
    "statement_md": "Statement",
}
PASSWORD_FIELDS = {"new", "password"}


def _label(loc: Sequence) -> tuple[str, str]:
    field = next((str(x) for x in reversed(loc) if isinstance(x, str) and x not in ("body", "query", "path")), "")
    if not field:
        return "", "The request"
    return field, LABELS.get(field) or field.replace("_", " ").capitalize()


def validation_message(errors: Sequence[dict]) -> str:
    if not errors:
        return "The request is not valid."
    e = errors[0]
    kind = e.get("type", "")
    ctx = e.get("ctx") or {}
    field, label = _label(e.get("loc") or ())
    if kind == "json_invalid":
        return "The request body is not valid JSON."
    if not field:
        return "The request body is missing or not valid JSON."
    if kind == "missing":
        return f"{label} is required."
    if kind in ("string_too_short", "string_too_long", "too_short", "too_long"):
        if field in PASSWORD_FIELDS and ctx.get("min_length", 0) != 1:
            return PW_POLICY
        if kind == "string_too_short" and ctx.get("min_length") == 1:
            return f"{label} is required."
        n = ctx.get("min_length") if "short" in kind else ctx.get("max_length")
        unit = "characters" if kind.startswith("string") else "items"
        return f"{label} must be {'at least' if 'short' in kind else 'at most'} {n} {unit}."
    if kind in ("literal_error", "enum"):
        return f"{label} must be one of {ctx.get('expected', 'the allowed values')}."
    if kind in ("int_parsing", "int_type", "float_parsing", "float_type", "int_from_float"):
        return f"{label} must be a number."
    if kind in ("bool_parsing", "bool_type"):
        return f"{label} must be true or false."
    if kind in ("greater_than_equal", "greater_than"):
        return f"{label} must be at least {ctx.get('ge', ctx.get('gt'))}."
    if kind in ("less_than_equal", "less_than"):
        return f"{label} must be at most {ctx.get('le', ctx.get('lt'))}."
    if kind in ("string_type", "list_type", "dict_type", "model_attributes_type"):
        return f"{label} has the wrong type."
    return f"{label} is not valid."
