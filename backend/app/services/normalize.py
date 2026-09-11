"""Normalisation: turn a source's shape into one consistent record.

Sources disagree about everything — where salary lives, how remote work is
described, whether requirements are a field or a paragraph. Everything downstream
reads the normalised form, so the scorer and the interface never need to know
which board a job came from.
"""
from __future__ import annotations

import re
from urllib.parse import urlparse

from ..models.enums import RemoteType, Seniority
from ..sources.base import RawJob

# Technologies are detected rather than trusted, because most sources send none.
# The pattern is word-boundary anchored so "Go" does not match "Google".
_TECH_VOCABULARY: dict[str, list[str]] = {
    "Angular": [r"angular"],
    "React": [r"react(?:\.js)?"],
    "Vue": [r"vue(?:\.js)?"],
    "Svelte": [r"svelte"],
    "TypeScript": [r"typescript", r"\bts\b"],
    "JavaScript": [r"javascript", r"\bes6\b"],
    "Node.js": [r"node\.?js"],
    "Python": [r"python"],
    "Django": [r"django"],
    "FastAPI": [r"fastapi"],
    "Java": [r"\bjava\b"],
    "Spring": [r"spring boot", r"\bspring\b"],
    "Kotlin": [r"kotlin"],
    "C#": [r"c#", r"c-sharp", r"csharp"],
    ".NET": [r"\.net", r"dotnet", r"asp\.net"],
    "Go": [r"\bgolang\b", r"\bgo\b(?= developer| engineer| programming)"],
    "Rust": [r"\brust\b"],
    "Ruby": [r"\bruby\b"],
    "Rails": [r"rails"],
    "PHP": [r"\bphp\b"],
    "Laravel": [r"laravel"],
    "Swift": [r"\bswift\b"],
    "SQL": [r"\bsql\b"],
    "PostgreSQL": [r"postgres(?:ql)?"],
    "MySQL": [r"mysql"],
    "SQL Server": [r"sql server", r"mssql"],
    "MongoDB": [r"mongo(?:db)?"],
    "Redis": [r"\bredis\b"],
    "GraphQL": [r"graphql"],
    "REST": [r"\brest(?:ful)? api"],
    "Docker": [r"docker"],
    "Kubernetes": [r"kubernetes", r"\bk8s\b"],
    "Terraform": [r"terraform"],
    "AWS": [r"\baws\b", r"amazon web services"],
    "Azure": [r"\bazure\b"],
    "GCP": [r"\bgcp\b", r"google cloud"],
    "CI/CD": [r"ci/cd", r"continuous integration"],
    "Git": [r"\bgit\b"],
    "Linux": [r"linux"],
    "RxJS": [r"rxjs"],
    "NgRx": [r"ngrx"],
    "Redux": [r"redux"],
    "Tailwind": [r"tailwind"],
    "CSS": [r"\bcss\b", r"\bscss\b", r"\bsass\b"],
    "HTML": [r"\bhtml5?\b"],
    "Jest": [r"\bjest\b"],
    "Cypress": [r"cypress"],
    "Playwright": [r"playwright"],
    "Storybook": [r"storybook"],
    "Figma": [r"figma"],
    "Kafka": [r"kafka"],
    "Elasticsearch": [r"elasticsearch", r"\belastic\b"],
    "Spark": [r"\bspark\b"],
    "PyTorch": [r"pytorch"],
    "TensorFlow": [r"tensorflow"],
}

_COMPILED_TECH = {
    name: re.compile("|".join(patterns), re.IGNORECASE)
    for name, patterns in _TECH_VOCABULARY.items()
}

_SENIORITY_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    (Seniority.INTERN, re.compile(r"\b(intern|internship|trainee|working student)\b", re.I)),
    (Seniority.PRINCIPAL, re.compile(r"\b(principal|distinguished|fellow)\b", re.I)),
    (Seniority.EXECUTIVE, re.compile(r"\b(head of|director|vp |vice president|cto|chief)\b", re.I)),
    (Seniority.LEAD, re.compile(r"\b(lead|staff|manager|architect)\b", re.I)),
    (Seniority.SENIOR, re.compile(r"\b(senior|sr\.?|snr)\b", re.I)),
    (Seniority.JUNIOR, re.compile(r"\b(junior|jr\.?|graduate|entry[- ]level|associate)\b", re.I)),
]

_REMOTE_RE = re.compile(r"\b(fully remote|remote[- ]first|100% remote|work from home|wfh)\b", re.I)
_REMOTE_WORD_RE = re.compile(r"\bremote\b", re.I)
_HYBRID_RE = re.compile(r"\bhybrid\b", re.I)
_ONSITE_RE = re.compile(r"\b(on[- ]site|onsite|in[- ]office)\b", re.I)

# Salary in the forms boards actually use: "€55,000 - €72,000", "$120k-$160k".
_SALARY_RE = re.compile(
    r"(?P<cur>[$€£]|USD|EUR|GBP)?\s?(?P<low>\d{1,3}(?:[.,]\d{3})+|\d{2,3})\s?(?P<lowk>k\b)?"
    r"\s*(?:-|–|—|to)\s*"
    r"(?P<cur2>[$€£]|USD|EUR|GBP)?\s?(?P<high>\d{1,3}(?:[.,]\d{3})+|\d{2,3})\s?(?P<highk>k\b)?",
    re.IGNORECASE,
)

_CURRENCY_SYMBOLS = {"$": "USD", "€": "EUR", "£": "GBP"}

# Headings a job description uses to separate requirements from the rest.
_REQUIREMENT_HEADING = re.compile(
    r"^\s*(?:what (?:we|you).{0,30}(?:looking for|need|bring)|requirements?|qualifications?|"
    r"who you are|about you|must have|you have|your profile|skills? (?:and|&) experience)\s*:?\s*$",
    re.IGNORECASE | re.MULTILINE,
)
_RESPONSIBILITY_HEADING = re.compile(
    r"^\s*(?:what you.{0,20}(?:do|ll be doing)|responsibilities|the role|your role|"
    r"about the (?:role|job)|day to day)\s*:?\s*$",
    re.IGNORECASE | re.MULTILINE,
)
_OTHER_HEADING = re.compile(
    r"^\s*(?:benefits?|what we offer|perks|about (?:us|the company)|our stack|"
    r"interview process|how to apply|equal opportunit)\w*\s*:?\s*$",
    re.IGNORECASE | re.MULTILINE,
)


def detect_technologies(*texts: str) -> list[str]:
    """Technologies mentioned anywhere in the given text, in vocabulary order."""
    haystack = "\n".join(text for text in texts if text)
    if not haystack:
        return []
    return [name for name, pattern in _COMPILED_TECH.items() if pattern.search(haystack)]


def detect_seniority(title: str, description: str = "") -> str:
    """Seniority from the title first, then the body.

    The title wins because a senior posting frequently says "you will mentor
    juniors" in the body, and matching that would mislabel the role.
    """
    for level, pattern in _SENIORITY_PATTERNS:
        if pattern.search(title or ""):
            return level
    head = (description or "")[:600]
    for level, pattern in _SENIORITY_PATTERNS:
        if pattern.search(head):
            return level
    return Seniority.UNKNOWN


def detect_remote_type(location: str, description: str, declared: str) -> str:
    """Remote type, preferring what the source explicitly declared."""
    if declared and declared != RemoteType.UNKNOWN:
        return declared
    combined = f"{location}\n{description[:1500]}"
    if _HYBRID_RE.search(combined):
        return RemoteType.HYBRID
    if _REMOTE_RE.search(combined):
        return RemoteType.REMOTE
    if _ONSITE_RE.search(combined):
        return RemoteType.ONSITE
    if _REMOTE_WORD_RE.search(location or ""):
        return RemoteType.REMOTE
    return RemoteType.UNKNOWN


def parse_salary(text: str) -> tuple[float | None, float | None, str]:
    """Best-effort salary range.

    Returns ``(None, None, "")`` rather than a guess when the text is ambiguous.
    A wrong salary is worse than no salary, because the user filters on it.
    """
    if not text:
        return None, None, ""
    match = _SALARY_RE.search(text)
    if not match:
        return None, None, ""

    def _value(raw: str, has_k: bool) -> float:
        number = float(raw.replace(",", "").replace(".", ""))
        return number * 1000 if has_k else number

    try:
        low = _value(match.group("low"), bool(match.group("lowk")))
        high = _value(match.group("high"), bool(match.group("highk")))
    except ValueError:
        return None, None, ""

    if low <= 0 or high <= 0 or high < low:
        return None, None, ""
    # Anything below a plausible annual figure is a count, a year or a version.
    if high < 10000:
        return None, None, ""

    currency_token = match.group("cur") or match.group("cur2") or ""
    currency = _CURRENCY_SYMBOLS.get(currency_token, currency_token.upper())
    return low, high, currency


def split_sections(description: str) -> tuple[str, str, str]:
    """Split a description into (body, requirements, responsibilities).

    Sources rarely provide these separately, and the job detail view needs them
    apart. Headings that belong to neither section end the capture, so benefits
    do not leak into requirements.
    """
    if not description:
        return "", "", ""

    lines = description.splitlines()
    body: list[str] = []
    requirements: list[str] = []
    responsibilities: list[str] = []
    current = body

    for line in lines:
        if _REQUIREMENT_HEADING.match(line):
            current = requirements
            continue
        if _RESPONSIBILITY_HEADING.match(line):
            current = responsibilities
            continue
        if _OTHER_HEADING.match(line):
            current = body
            body.append(line)
            continue
        current.append(line)

    def _clean(chunk: list[str]) -> str:
        return "\n".join(chunk).strip()

    return _clean(body), _clean(requirements), _clean(responsibilities)


def split_location(location: str) -> tuple[str, str]:
    """Split "Lisbon, Portugal" into city and country, tolerating noise."""
    if not location:
        return "", ""
    cleaned = re.sub(r"\s*\(.*?\)\s*", " ", location).strip()
    parts = [part.strip() for part in cleaned.split(",") if part.strip()]
    if not parts:
        return "", ""
    if len(parts) == 1:
        single = parts[0]
        return ("", single) if _REMOTE_WORD_RE.fullmatch(single) else (single, "")
    return parts[0], parts[-1]


def domain_from_url(url: str) -> str:
    if not url:
        return ""
    try:
        host = urlparse(url).netloc.lower()
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host


def normalize(raw: RawJob) -> RawJob:
    """Return ``raw`` with every derived field filled in.

    The function is pure and idempotent: running it twice changes nothing, which
    matters because a re-discovered job is normalised again on every run.
    """
    body, requirements, responsibilities = split_sections(raw.description)

    raw.description = body or raw.description
    raw.requirements = raw.requirements or requirements
    raw.responsibilities = raw.responsibilities or responsibilities

    # Some sources ship free-form tags. Those feed technology detection rather
    # than being trusted as technologies outright, because a tag list mixes
    # "React" with "digital nomad" and "exec".
    tag_text = str((raw.raw_payload or {}).get("tag_text", ""))
    full_text = "\n".join(
        [raw.title, raw.description, raw.requirements, raw.responsibilities, tag_text]
    )

    detected = detect_technologies(full_text)
    merged = list(dict.fromkeys([*raw.technologies, *detected]))
    raw.technologies = merged

    if raw.seniority in ('', Seniority.UNKNOWN):
        raw.seniority = detect_seniority(raw.title, raw.description)
    raw.remote_type = detect_remote_type(raw.location, full_text, raw.remote_type)

    if raw.salary_min is None and raw.salary_max is None:
        low, high, currency = parse_salary(full_text)
        raw.salary_min, raw.salary_max = low, high
        raw.salary_currency = raw.salary_currency or currency

    if not raw.company_domain:
        raw.company_domain = domain_from_url(raw.application_url or raw.canonical_url)

    raw.title = re.sub(r"\s+", " ", raw.title).strip()
    raw.company = re.sub(r"\s+", " ", raw.company).strip()

    return raw
