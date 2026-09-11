"""Master CV import.

Reading a CV is done without any third-party parsing library, because adding a
dependency for PDF and DOCX would mean the user cannot import until they install
something. Both formats are containers whose text can be recovered from the
standard library:

* DOCX is a ZIP of XML; the document text lives in ``word/document.xml``.
* PDF text lives in Flate-compressed content streams, which ``zlib`` decodes and
  a small tokeniser reads.

The PDF reader handles the text-based PDFs that a CV exported from Word, Google
Docs or LaTeX produces. A scanned PDF has no text layer at all, and the route
says so plainly rather than returning an empty profile.

Extraction is then a heuristic pass, optionally refined by the model. Either way
the result is a *preview*: the user reviews and edits every field before it
becomes the profile. Nothing here writes to the candidate row.
"""
from __future__ import annotations

import io
import re
import zipfile
import zlib

from pydantic import BaseModel, Field

from ..llm import LLMUnavailable, get_llm, wrap_untrusted
from ..schemas.candidate import (
    CertificationEntry,
    EducationEntry,
    ExperienceEntry,
    LanguageEntry,
    ProjectEntry,
)


class ImportPreview(BaseModel):
    """What was extracted, plus how it was extracted and what to check."""

    full_name: str = ""
    email: str = ""
    phone: str = ""
    location: str = ""
    headline: str = ""
    summary: str = ""
    linkedin_url: str = ""
    github_url: str = ""
    website_url: str = ""
    years_of_experience: float = 0.0
    current_role: str = ""
    experience: list[ExperienceEntry] = Field(default_factory=list)
    education: list[EducationEntry] = Field(default_factory=list)
    projects: list[ProjectEntry] = Field(default_factory=list)
    certifications: list[CertificationEntry] = Field(default_factory=list)
    languages: list[LanguageEntry] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    technologies: list[str] = Field(default_factory=list)

    method: str = "heuristic"
    #: The raw text, so the user can copy anything the extractor missed.
    source_text: str = ""
    warnings: list[str] = Field(default_factory=list)


# -- file readers ---------------------------------------------------------------


def read_upload(filename: str, data: bytes) -> str:
    """Plain text from a CV upload, by extension."""
    lowered = (filename or "").lower()
    if lowered.endswith(".docx"):
        return _read_docx(data)
    if lowered.endswith(".pdf"):
        return _read_pdf(data)
    if lowered.endswith((".txt", ".md", ".markdown")):
        return data.decode("utf-8", errors="replace")
    # Unknown extension: try text, which is right more often than failing.
    return data.decode("utf-8", errors="replace")


_XML_PARAGRAPH = re.compile(r"<w:p[ >].*?</w:p>|<w:p/>", re.DOTALL)
_XML_TEXT = re.compile(r"<w:t[^>]*>(.*?)</w:t>", re.DOTALL)
_XML_TAG = re.compile(r"<[^>]+>")


def _read_docx(data: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            xml = archive.read("word/document.xml").decode("utf-8", errors="replace")
    except (zipfile.BadZipFile, KeyError):
        return ""

    lines: list[str] = []
    for paragraph in _XML_PARAGRAPH.findall(xml):
        parts = [_XML_TAG.sub("", piece) for piece in _XML_TEXT.findall(paragraph)]
        line = "".join(parts).strip()
        if line:
            lines.append(_unescape(line))
    return "\n".join(lines)


def _unescape(value: str) -> str:
    return (
        value.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&apos;", "'")
    )


_STREAM = re.compile(rb"stream\r?\n(.*?)\r?\nendstream", re.DOTALL)
# Text-showing operators: (text) Tj, [(a) -2 (b)] TJ, and the quote variants.
_SHOW_TEXT = re.compile(rb"\((?:\\.|[^\\()])*\)")
_TEXT_OPERATOR = re.compile(rb"(?:Tj|TJ|'|\")")
_NEWLINE_OPERATOR = re.compile(rb"\b(?:Td|TD|T\*|ET)\b")


def _read_pdf(data: bytes) -> str:
    """Text from a PDF's content streams.

    Only uncompressed and Flate-compressed streams are handled, which covers
    every mainstream CV exporter. Anything else contributes nothing rather than
    raising, so a partially readable PDF still yields its readable pages.
    """
    chunks: list[str] = []
    for match in _STREAM.finditer(data):
        raw = match.group(1)
        try:
            content = zlib.decompress(raw)
        except zlib.error:
            content = raw
        text = _extract_pdf_text(content)
        if text.strip():
            chunks.append(text)
    return "\n".join(chunks).strip()


def _extract_pdf_text(content: bytes) -> str:
    out: list[str] = []
    position = 0
    length = len(content)

    while position < length:
        literal = _SHOW_TEXT.search(content, position)
        if literal is None:
            break
        out.append(_decode_pdf_string(literal.group(0)[1:-1]))

        # A positioning or end-of-text operator between this string and the next
        # means a line break rather than a continuation.
        next_literal = _SHOW_TEXT.search(content, literal.end())
        window_end = next_literal.start() if next_literal else length
        window = content[literal.end() : window_end]
        if _NEWLINE_OPERATOR.search(window):
            out.append("\n")
        elif _TEXT_OPERATOR.search(window):
            out.append(" ")
        position = literal.end()

    text = "".join(out)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return "\n".join(line.strip() for line in text.splitlines()).strip()


_PDF_ESCAPES = {
    b"n": "\n",
    b"r": "\n",
    b"t": "\t",
    b"b": "",
    b"f": "",
    b"(": "(",
    b")": ")",
    b"\\": "\\",
}


def _decode_pdf_string(raw: bytes) -> str:
    out: list[str] = []
    index = 0
    while index < len(raw):
        byte = raw[index : index + 1]
        if byte == b"\\" and index + 1 < len(raw):
            following = raw[index + 1 : index + 2]
            if following in _PDF_ESCAPES:
                out.append(_PDF_ESCAPES[following])
                index += 2
                continue
            if following.isdigit():
                octal = raw[index + 1 : index + 4]
                try:
                    out.append(chr(int(octal, 8)))
                    index += 1 + len(octal)
                    continue
                except ValueError:
                    pass
            index += 1
            continue
        out.append(byte.decode("latin-1", errors="replace"))
        index += 1
    return "".join(out)


# -- extraction -----------------------------------------------------------------

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]{2,}")
_PHONE = re.compile(r"(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{2,4}")
_LINKEDIN = re.compile(r"(?:https?://)?(?:www\.)?linkedin\.com/in/[\w-]+/?", re.I)
_GITHUB = re.compile(r"(?:https?://)?(?:www\.)?github\.com/[\w-]+/?", re.I)
_URL = re.compile(r"https?://[^\s,;]+")

_SECTION_HEADINGS = {
    "experience": re.compile(
        r"^\s*(?:work\s+)?(?:professional\s+)?experience\s*:?\s*$|^\s*employment(?:\s+history)?\s*:?\s*$",
        re.I,
    ),
    "education": re.compile(r"^\s*education(?:\s+and\s+training)?\s*:?\s*$", re.I),
    "skills": re.compile(r"^\s*(?:technical\s+)?skills?\s*:?\s*$|^\s*technologies\s*:?\s*$", re.I),
    "projects": re.compile(r"^\s*projects?\s*:?\s*$", re.I),
    "certifications": re.compile(r"^\s*certifications?\s*:?\s*$|^\s*licen[cs]es\s*:?\s*$", re.I),
    "languages": re.compile(r"^\s*languages?\s*:?\s*$", re.I),
    "summary": re.compile(r"^\s*(?:professional\s+)?(?:summary|profile|about(?:\s+me)?)\s*:?\s*$", re.I),
}


def _split_sections(text: str) -> dict[str, str]:
    lines = text.splitlines()
    sections: dict[str, list[str]] = {"header": []}
    current = "header"
    for line in lines:
        matched = next(
            (name for name, pattern in _SECTION_HEADINGS.items() if pattern.match(line)), None
        )
        if matched:
            current = matched
            sections.setdefault(current, [])
            continue
        sections.setdefault(current, []).append(line)
    return {name: "\n".join(body).strip() for name, body in sections.items()}


def extract_heuristic(text: str) -> ImportPreview:
    """Extract what can be found with patterns alone.

    This always runs, and it is what the user sees if no model is available. It
    is deliberately cautious: a field it is not confident about is left empty for
    the user to fill, rather than guessed.
    """
    preview = ImportPreview(method="heuristic", source_text=text)
    sections = _split_sections(text)
    header = sections.get("header", "")

    email = _EMAIL.search(text)
    preview.email = email.group(0) if email else ""

    linkedin = _LINKEDIN.search(text)
    preview.linkedin_url = linkedin.group(0) if linkedin else ""
    github = _GITHUB.search(text)
    preview.github_url = github.group(0) if github else ""

    for url in _URL.finditer(text):
        candidate_url = url.group(0)
        if "linkedin.com" in candidate_url or "github.com" in candidate_url:
            continue
        preview.website_url = candidate_url
        break

    phone_area = header or text[:600]
    phone = _PHONE.search(phone_area)
    if phone and len(re.sub(r"\D", "", phone.group(0))) >= 9:
        preview.phone = phone.group(0).strip()

    # The name is nearly always the first non-empty line that is not contact data.
    for line in header.splitlines():
        stripped = line.strip()
        if not stripped or _EMAIL.search(stripped) or _URL.search(stripped):
            continue
        if len(stripped) > 60 or stripped.count(" ") > 5:
            continue
        preview.full_name = stripped
        break

    header_lines = [line.strip() for line in header.splitlines() if line.strip()]
    if preview.full_name in header_lines:
        index = header_lines.index(preview.full_name)
        for line in header_lines[index + 1 : index + 4]:
            if _EMAIL.search(line) or _URL.search(line) or _PHONE.fullmatch(line):
                continue
            preview.headline = line[:200]
            break

    summary = sections.get("summary", "")
    preview.summary = summary.strip()[:2000] if summary else ""

    skills_text = sections.get("skills", "")
    if skills_text:
        from .normalize import detect_technologies

        tokens = [
            token.strip(" .•-\t")
            for token in re.split(r"[,;•\n|]", skills_text)
            if 1 < len(token.strip(" .•-\t")) <= 40
        ]
        preview.skills = list(dict.fromkeys(tokens))[:60]
        preview.technologies = detect_technologies(skills_text, text)

    if not preview.warnings and not sections.get("experience"):
        preview.warnings.append(
            "No experience section was recognised. Add your roles by hand before generating a CV."
        )
    return preview


_IMPORT_SYSTEM = (
    "You extract structured data from a CV. "
    "Copy values exactly as written. Never infer, never complete a partial date, "
    "never add a technology or employer that is not in the text. "
    "If a field is absent, return an empty string or an empty list. "
    "Reply with JSON only, with these keys: full_name, email, phone, location, headline, "
    "summary, current_role, years_of_experience (number), "
    "experience (list of {title, company, location, start, end, highlights[]}), "
    "education (list of {degree, institution, location, start, end}), "
    "projects (list of {name, description, url, technologies[]}), "
    "certifications (list of {name, issuer, year}), "
    "languages (list of {name, level}), skills (list of strings)."
)


async def extract_profile(text: str) -> ImportPreview:
    """Heuristic extraction, refined by the model when one is available."""
    baseline = extract_heuristic(text)

    try:
        payload = await get_llm().complete_json(
            _IMPORT_SYSTEM,
            wrap_untrusted("cv_text", text, 20000),
        )
    except (LLMUnavailable, Exception):  # noqa: BLE001 - heuristics are the fallback
        baseline.warnings.append(
            "The local model was unavailable, so fields were extracted by pattern matching only. "
            "Check every field before saving."
        )
        return baseline

    if not isinstance(payload, dict):
        return baseline

    merged = baseline.model_copy(deep=True)
    merged.method = "model"
    merged.warnings = [
        "Every field was extracted automatically. Check each one against your CV before saving."
    ]

    for field in (
        "full_name",
        "email",
        "phone",
        "location",
        "headline",
        "summary",
        "current_role",
    ):
        value = payload.get(field)
        if isinstance(value, str) and value.strip():
            setattr(merged, field, value.strip())

    try:
        merged.years_of_experience = float(payload.get("years_of_experience") or 0)
    except (TypeError, ValueError):
        merged.years_of_experience = baseline.years_of_experience

    merged.experience = _coerce_list(payload.get("experience"), ExperienceEntry)
    merged.education = _coerce_list(payload.get("education"), EducationEntry)
    merged.projects = _coerce_list(payload.get("projects"), ProjectEntry)
    merged.certifications = _coerce_list(payload.get("certifications"), CertificationEntry)
    merged.languages = _coerce_list(payload.get("languages"), LanguageEntry)

    skills = payload.get("skills")
    if isinstance(skills, list) and skills:
        merged.skills = [str(item).strip() for item in skills if str(item).strip()][:80]

    from .normalize import detect_technologies

    merged.technologies = detect_technologies(text) or baseline.technologies

    if not merged.experience:
        merged.warnings.append(
            "No experience entries were extracted. Add your roles by hand before generating a CV."
        )
    return merged


def _coerce_list(value, model) -> list:
    """Build validated entries, skipping anything malformed rather than failing."""
    if not isinstance(value, list):
        return []
    out = []
    for item in value[:40]:
        if not isinstance(item, dict):
            continue
        try:
            out.append(model(**{key: item.get(key) for key in model.model_fields if key in item}))
        except Exception:  # noqa: BLE001 - one bad entry must not lose the rest
            continue
    return out
