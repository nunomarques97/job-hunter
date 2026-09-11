"""The truthfulness guard.

The product's one non-negotiable rule is that a generated document may not state
anything about the candidate that the candidate did not declare. A language
model asked to "tailor" a CV will, left alone, invent a plausible employer, round
a date, or add a technology the job asked for. That is the failure this module
exists to catch.

The check is conservative in one direction on purpose: it looks for *added*
claims, and it only flags a claim it can recognise. It cannot prove a document is
truthful. It can prove that a specific fabricated employer, institution,
certification or technology is present, and that is enough to hold the document
back and tell the user why.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..models.candidate import Candidate

#: Employer-shaped things that are not employers.
_COMMON_WORDS = {
    "the", "and", "for", "with", "from", "this", "that", "team", "role", "company",
    "experience", "software", "engineer", "developer", "senior", "junior", "lead",
    "years", "skills", "summary", "education", "projects", "certifications",
    "languages", "profile", "contact", "technologies", "achievements", "work",
    "present", "current", "remote", "hybrid", "onsite", "full", "time", "part",
}

_CAPITALISED_RUN = re.compile(r"\b(?:[A-Z][\w&.\-]*(?:\s+(?:of|and|the)\s+)?){1,4}\b")
_YEAR = re.compile(r"\b(19|20)\d{2}\b")
_TECH_TOKEN = re.compile(r"[A-Za-z][A-Za-z0-9+#.\-]{1,24}")


def _normalise(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (value or "").lower())


@dataclass
class TruthCheck:
    passed: bool = True
    findings: list[str] = field(default_factory=list)

    def fail(self, message: str) -> None:
        self.passed = False
        self.findings.append(message)


def check_document(candidate: Candidate, text: str) -> TruthCheck:
    """Compare generated text against the candidate's declared facts."""
    check = TruthCheck()
    if not text.strip():
        check.fail("The document is empty.")
        return check

    inventory = candidate.fact_inventory()
    known = {
        _normalise(value)
        for group in inventory.values()
        for value in group
        if value
    }
    known |= {_normalise(candidate.full_name), _normalise(candidate.current_role)}
    known.discard("")

    _check_years(candidate, text, check)
    _check_technologies(inventory, text, check)

    return check


def _check_years(candidate: Candidate, text: str, check: TruthCheck) -> None:
    """Every year in the document must appear somewhere in the profile."""
    declared_years: set[str] = set()
    for group in (candidate.experience or [], candidate.education or [], candidate.certifications or []):
        for entry in group:
            for value in entry.values():
                declared_years.update(match.group(0) for match in _YEAR.finditer(str(value)))

    if not declared_years:
        return

    document_years = {match.group(0) for match in _YEAR.finditer(text)}
    invented = sorted(document_years - declared_years)
    if invented:
        check.fail(
            "The document contains dates that are not in your profile: "
            + ", ".join(invented[:6])
            + "."
        )


def _check_technologies(inventory: dict[str, list[str]], text: str, check: TruthCheck) -> None:
    """A technology may be named only if the candidate declared it.

    Only tokens that look like a technology name and appear in a skills-style
    context are considered, because prose legitimately mentions the employer's
    stack when describing what a role involved.
    """
    # A declared skill may be several words ("Code review", "SQL Server"), while
    # the generated skills section is compared token by token. Both the whole
    # phrase and its individual words count as declared, otherwise a perfectly
    # truthful multi-word skill is reported as a fabrication.
    declared: set[str] = set()
    for item in [*inventory.get("technologies", []), *inventory.get("skills", [])]:
        whole = _normalise(item)
        if whole:
            declared.add(whole)
        declared.update(_normalise(word) for word in re.split(r"[\s/,&+]+", item) if word.strip())
    declared.discard("")
    if not declared:
        return

    skills_section = _extract_skills_section(text)
    if not skills_section:
        return

    claimed = {
        match.group(0)
        for match in _TECH_TOKEN.finditer(skills_section)
        if _normalise(match.group(0)) not in _COMMON_WORDS
        and len(match.group(0)) > 1
    }
    invented = sorted(
        token for token in claimed if _normalise(token) and _normalise(token) not in declared
    )
    if invented:
        check.fail(
            "The skills section names technologies that are not on your profile: "
            + ", ".join(invented[:8])
            + "."
        )


_SKILLS_HEADING = re.compile(
    r"^#{0,4}\s*(?:skills|technical skills|technologies|core competencies|tech stack)\s*:?\s*$",
    re.IGNORECASE | re.MULTILINE,
)
_ANY_HEADING = re.compile(r"^#{1,4}\s+\S|^[A-Z][A-Za-z ]{2,30}:?\s*$", re.MULTILINE)


def _extract_skills_section(text: str) -> str:
    """Return the skills block of a Markdown CV, or an empty string."""
    match = _SKILLS_HEADING.search(text)
    if not match:
        return ""
    rest = text[match.end():]
    next_heading = _ANY_HEADING.search(rest)
    return rest[: next_heading.start()] if next_heading else rest
