from typing import Any, Dict, List, Optional

from open_notebook.domain.notebook import Notebook
from open_notebook.utils.context_builder import build_notebook_context


def _format_source(source: Dict[str, Any]) -> str:
    title = source.get("title") or "Untitled source"
    parts: List[str] = []

    full_text = source.get("full_text")
    if full_text and str(full_text).strip():
        parts.append(str(full_text).strip())

    insight_lines = []
    for insight in source.get("insights") or []:
        if isinstance(insight, dict) and insight.get("content"):
            kind = insight.get("insight_type") or "Insight"
            insight_lines.append(f"- {kind}: {insight['content']}")
    if insight_lines:
        parts.append("Insights:\n" + "\n".join(insight_lines))

    body = "\n\n".join(parts)
    return f"## Source: {title}\n\n{body}" if body else ""


def _format_note(note: Dict[str, Any]) -> str:
    title = note.get("title") or "Untitled note"
    content = note.get("content")
    body = str(content).strip() if content else ""
    return f"## Note: {title}\n\n{body}" if body else ""


def format_quiz_content(context_data: Dict[str, list]) -> str:
    """Render a built notebook context as the plain text the quiz prompt reads.

    Same shape as ``Notebook.get_context()`` so a quiz built from a selection
    and one built from a whole notebook see the same kind of text. Items with
    no usable text are skipped.
    """
    blocks = [_format_source(s) for s in context_data.get("sources", []) if s]
    blocks += [_format_note(n) for n in context_data.get("notes", []) if n]
    return "\n\n".join(block for block in blocks if block)


class QuizService:
    @staticmethod
    async def build_content(
        notebook: Notebook, context_config: Optional[Dict[str, Any]]
    ) -> str:
        """Text to generate a quiz from: the selection, or the whole notebook."""
        if not context_config:
            return (await notebook.get_context()).strip()

        context_data, _ = await build_notebook_context(notebook, context_config)
        return format_quiz_content(context_data).strip()
