"""Unit tests for the logic that has to be right.

No server, no network, no model. Run with:

    python tests/test_units.py
"""
from __future__ import annotations

import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.base import utcnow  # noqa: E402
from app.models.candidate import Candidate  # noqa: E402
from app.models.enums import RemoteType, Seniority  # noqa: E402
from app.models.job import Job  # noqa: E402
from app.services import dedupe  # noqa: E402
from app.services.cv_import import extract_heuristic  # noqa: E402
from app.services.normalize import (  # noqa: E402
    detect_remote_type,
    detect_seniority,
    detect_technologies,
    parse_salary,
    split_location,
    split_sections,
)
from app.services.scoring import score_deterministic  # noqa: E402
from app.services.truthfulness import check_document  # noqa: E402
from app.sources.base import strip_html  # noqa: E402

passed = 0
failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    global passed
    if condition:
        passed += 1
    else:
        failures.append(f"{label}  {detail}")
        print(f"  FAIL  {label}  {detail}")


def group(name: str) -> None:
    print(f"\n{name}")


# -- normalisation --------------------------------------------------------------

group("Technology detection")
check("finds Angular and TypeScript", set(detect_technologies("We use Angular and TypeScript")) >= {"Angular", "TypeScript"})
check("Go does not match Google", "Go" not in detect_technologies("We use Google Analytics"))
check("Go matches a Go role", "Go" in detect_technologies("Looking for a Go developer"))
check("Java does not swallow JavaScript only", "JavaScript" in detect_technologies("JavaScript and CSS"))
check("empty text yields nothing", detect_technologies("") == [])

group("Seniority detection")
check("senior from title", detect_seniority("Senior Frontend Engineer") == Seniority.SENIOR)
check("junior from title", detect_seniority("Junior Developer") == Seniority.JUNIOR)
check("principal beats lead", detect_seniority("Principal Engineer") == Seniority.PRINCIPAL)
check("intern detected", detect_seniority("Software Engineering Intern") == Seniority.INTERN)
check(
    "body does not override the title",
    detect_seniority("Senior Engineer", "You will mentor junior developers") == Seniority.SENIOR,
)
check("unknown when nothing matches", detect_seniority("Software Engineer") == Seniority.UNKNOWN)

group("Remote detection")
check("declared value wins", detect_remote_type("Lisbon", "fully remote", RemoteType.ONSITE) == RemoteType.ONSITE)
check("hybrid from text", detect_remote_type("Porto", "This is a hybrid role", RemoteType.UNKNOWN) == RemoteType.HYBRID)
check("remote from location", detect_remote_type("Remote (EU)", "", RemoteType.UNKNOWN) == RemoteType.REMOTE)
check("onsite from text", detect_remote_type("Madrid", "fully on-site position", RemoteType.UNKNOWN) == RemoteType.ONSITE)

group("Salary parsing")
low, high, currency = parse_salary("Salary: €55,000 - €72,000 per year")
check("euro range", (low, high, currency) == (55000.0, 72000.0, "EUR"), f"{low},{high},{currency}")
low, high, currency = parse_salary("$120k-$160k")
check("dollar k notation", (low, high, currency) == (120000.0, 160000.0, "USD"), f"{low},{high},{currency}")
check("no salary in prose", parse_salary("We have 5 to 10 engineers") == (None, None, ""))
check("version numbers ignored", parse_salary("Angular 14 to 17") == (None, None, ""))
check("empty text", parse_salary("") == (None, None, ""))

group("Location splitting")
check("city and country", split_location("Lisbon, Portugal") == ("Lisbon", "Portugal"))
check("remote only", split_location("Remote") == ("", "Remote"))
check("parenthetical stripped", split_location("Porto, Portugal (hybrid)") == ("Porto", "Portugal"))
check("empty", split_location("") == ("", ""))

group("Section splitting")
body, requirements, responsibilities = split_sections(
    "We build things.\nRequirements:\n- 5 years Angular\n- TypeScript\nBenefits\n- Free lunch"
)
check("requirements captured", "5 years Angular" in requirements, requirements)
check("benefits do not leak into requirements", "Free lunch" not in requirements, requirements)

group("HTML stripping")
text = strip_html("<p>We use <b>Angular</b>.</p><ul><li>Item one</li><li>Item two</li></ul>")
check("tags removed", "<" not in text, text)
check("list items kept as lines", "Item one" in text and "Item two" in text, text)
check("entities decoded", "&" in strip_html("<p>R&amp;D</p>"))

# -- deduplication --------------------------------------------------------------

group("Deduplication")
check("identical titles match", dedupe.titles_match("Senior Frontend Engineer", "Senior Frontend Engineer"))
check("word order ignored", dedupe.titles_match("Frontend Engineer, Senior", "Senior Frontend Engineer"))
check("gender suffix ignored", dedupe.titles_match("Backend Engineer (m/f/d)", "Backend Engineer"))
check("different roles do not match", not dedupe.titles_match("Frontend Engineer", "Data Scientist"))
check("legal suffix ignored", dedupe.canonical_company("Acme Inc.") == dedupe.canonical_company("Acme"))
check("different companies differ", dedupe.canonical_company("Acme") != dedupe.canonical_company("Globex"))

# -- scoring --------------------------------------------------------------------

group("Scoring")


def make_candidate(**overrides) -> Candidate:
    candidate = Candidate(
        full_name="Test Person",
        technologies=["Angular", "TypeScript", "RxJS", "CSS"],
        skills=["Accessibility"],
        target_roles=["Frontend Engineer"],
        target_locations=["Porto"],
        target_countries=["Portugal"],
        seniority_targets=["mid", "senior"],
        min_salary=45000,
        remote_only=False,
        accepts_hybrid=True,
        accepts_onsite=True,
        willing_to_relocate=False,
        experience=[{"title": "Frontend Engineer", "company": "Vodafone", "start": "2021", "end": "2025"}],
    )
    for key, value in overrides.items():
        setattr(candidate, key, value)
    return candidate


def make_job(**overrides) -> Job:
    job = Job(
        source="sample",
        source_job_id="1",
        title="Senior Frontend Engineer",
        company="Northwind",
        location="Porto, Portugal",
        city="Porto",
        country="Portugal",
        remote_type=RemoteType.HYBRID,
        seniority=Seniority.SENIOR,
        technologies=["Angular", "TypeScript", "RxJS", "CSS"],
        salary_min=55000,
        salary_max=72000,
        description="x" * 500,
        discovered_at=utcnow(),
        posted_at=utcnow(),
    )
    for key, value in overrides.items():
        setattr(job, key, value)
    return job


perfect = score_deterministic(make_candidate(), make_job())
check("a perfect fit scores high", perfect.score >= 90, f"score={perfect.score}")
check("recommendation is strong apply", perfect.recommendation == "strong_apply", perfect.recommendation)
check("all six dimensions present", len(perfect.breakdown) == 6, str(list(perfect.breakdown)))
check("breakdown sums to the score", abs(sum(perfect.breakdown.values()) - perfect.score) < 0.2)

mismatch = score_deterministic(
    make_candidate(),
    make_job(technologies=["Java", "Spring", "Kafka"], title="Data Scientist", seniority=Seniority.PRINCIPAL),
)
check("a poor fit scores low", mismatch.score < 55, f"score={mismatch.score}")
check("missing skills listed", set(mismatch.missing_skills) == {"Java", "Spring", "Kafka"}, str(mismatch.missing_skills))

remote_only = score_deterministic(
    make_candidate(remote_only=True), make_job(remote_type=RemoteType.ONSITE)
)
check("remote-only candidate penalises onsite", remote_only.breakdown["location"] == 0.0, str(remote_only.breakdown))

stale = score_deterministic(make_candidate(), make_job(posted_at=utcnow() - timedelta(days=60)))
check("a stale posting scores lower", stale.score < perfect.score, f"{stale.score} vs {perfect.score}")

no_tech = score_deterministic(make_candidate(), make_job(technologies=[], description=""))
check("a thin posting has low confidence", no_tech.confidence < 50, f"confidence={no_tech.confidence}")
check("scores stay within bounds", 0 <= no_tech.score <= 100, f"score={no_tech.score}")

repeat = score_deterministic(make_candidate(), make_job())
check("scoring is deterministic", repeat.score == perfect.score, f"{repeat.score} vs {perfect.score}")

# -- truthfulness ---------------------------------------------------------------

group("Truthfulness guard")
candidate = make_candidate(
    skills=["Code review", "Accessibility"],
    education=[{"degree": "BSc", "institution": "Universidade do Minho", "start": "2015", "end": "2019"}],
)

honest = """# Test Person

## Experience
### Frontend Engineer — Vodafone
*2021 – 2025*

## Skills
Angular, TypeScript, RxJS, CSS, Code review, Accessibility
"""
result = check_document(candidate, honest)
check("an honest CV passes", result.passed, str(result.findings))

multiword = check_document(candidate, honest.replace("Code review", "Code review, Accessibility"))
check("a multi-word skill is not a false positive", multiword.passed, str(multiword.findings))

fabricated = honest.replace("Angular, TypeScript", "Angular, TypeScript, Kubernetes, Terraform")
result = check_document(candidate, fabricated)
check("an invented technology is caught", not result.passed, str(result.findings))
check("the finding names the invention", any("Kubernetes" in f for f in result.findings), str(result.findings))

invented_date = honest.replace("*2021 – 2025*", "*2017 – 2025*")
result = check_document(candidate, invented_date)
check("an invented date is caught", not result.passed, str(result.findings))

check("an empty document fails", not check_document(candidate, "").passed)

# -- CV import ------------------------------------------------------------------

group("CV import (heuristic)")
cv_text = """Nuno Marques
Frontend Engineer
nuno@example.com | +351 912 000 000
https://github.com/example

Summary
Frontend engineer with five years of Angular experience.

Experience
Frontend Engineer, Vodafone, 2021 - 2025

Skills
Angular, TypeScript, RxJS, CSS
"""
preview = extract_heuristic(cv_text)
check("name extracted", preview.full_name == "Nuno Marques", preview.full_name)
check("email extracted", preview.email == "nuno@example.com", preview.email)
check("github extracted", "github.com/example" in preview.github_url, preview.github_url)
check("headline extracted", preview.headline == "Frontend Engineer", preview.headline)
check("summary extracted", "Angular" in preview.summary, preview.summary[:50])
check("skills extracted", "Angular" in preview.skills, str(preview.skills))
check("technologies detected", "TypeScript" in preview.technologies, str(preview.technologies))
check("source text retained", preview.source_text == cv_text)

empty = extract_heuristic("")
check("empty CV does not crash", empty.full_name == "" and empty.email == "")

print(f"\n{'=' * 60}")
print(f"{passed} passed, {len(failures)} failed")
if failures:
    sys.exit(1)
print("All unit tests passed.")
