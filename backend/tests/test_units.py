"""Unit tests for the logic that has to be right.

No server, no network, no model. Run with:

    python tests/test_units.py
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
import tempfile
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Set before anything reads the settings, which are cached on first use. The
# route tests below start the real application, and it must not touch the real
# database, the real data directory or the real log file.
_DATA_DIR = Path(tempfile.mkdtemp(prefix="job-hunter-tests-"))
os.environ["JOB_HUNTER_DATA_DIR"] = str(_DATA_DIR)
# The model provider is replaced with a fake one further down. Naming it here,
# before the settings are built, is what keeps this suite off the network.
os.environ["JOB_HUNTER_LLM_PROVIDER"] = "fake"
os.environ["JOB_HUNTER_OLLAMA_MODEL_COVER_LETTER"] = "pinned-model:30b"

from app.core.logging import MASK, Redactor, redact_text  # noqa: E402
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

# -- log redaction --------------------------------------------------------------

group("Log redaction")

check(
    "a password assignment is masked",
    "hunter2" not in redact_text('connecting with password="hunter2"'),
    redact_text('connecting with password="hunter2"'),
)
check(
    "the mask is what replaces it",
    MASK in redact_text("password=hunter2"),
    redact_text("password=hunter2"),
)
check(
    "a json secret is masked",
    "s3cr3t" not in redact_text('{"client_secret": "s3cr3t", "user": "ada"}'),
    redact_text('{"client_secret": "s3cr3t", "user": "ada"}'),
)
check(
    "the rest of the line survives",
    "ada" in redact_text('{"client_secret": "s3cr3t", "user": "ada"}'),
)
check(
    "a bearer token is masked",
    "eyJhbGciOi" not in redact_text("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc"),
    redact_text("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc"),
)
check(
    "a password inside a url is masked",
    "letmein" not in redact_text("imap://someone:letmein@mail.example.com/"),
    redact_text("imap://someone:letmein@mail.example.com/"),
)
check(
    "an api key is masked",
    "abcd1234" not in redact_text("api_key=abcd1234"),
    redact_text("api_key=abcd1234"),
)

# A document body must not reach the log whole, however it is passed in.
document_body = (
    "PROFESSIONAL SUMMARY. Engineer with a decade of delivery experience. " * 40
    + "REFEREES AVAILABLE ON REQUEST."
)
redacted_body = redact_text(document_body)
check(
    "a document body is cut short",
    len(redacted_body) < len(document_body) / 4,
    str(len(redacted_body)),
)
check("the truncation is announced", "truncated" in redacted_body)
check("the tail of the body is gone", "REFEREES AVAILABLE" not in redacted_body)

# The filter is what enforces it, so test the filter rather than only the helper.
record = logging.LogRecord(
    name="job_hunter",
    level=logging.INFO,
    pathname=__file__,
    lineno=1,
    msg="stored %s for %s",
    args=(document_body, "password=hunter2"),
    exc_info=None,
)
Redactor().filter(record)
filtered = record.getMessage()
check("the filter truncates a body given as an argument", len(filtered) <= 460, str(len(filtered)))
check("the filter masks a password given as an argument", "hunter2" not in filtered, filtered)
check("the filter leaves no format arguments behind", record.args == ())

check(
    "an ordinary line is untouched",
    redact_text("database ready at C:/Users/example/AppData")
    == "database ready at C:/Users/example/AppData",
)


# -- the diagnostic panel: /api/info and the copied report ----------------------

group("Diagnostics")

from app.core.config import LLM_STAGES, get_settings  # noqa: E402
from app.llm import register_provider  # noqa: E402
from app.llm.base import LLMProvider, ModelInfo, ProviderStatus  # noqa: E402


class FakeProvider(LLMProvider):
    """A model runtime that is reachable and holds exactly one tag.

    The panel's whole point is telling apart a runtime that is down from one
    that is up without the configured model, so the fake is deliberately the
    second case: it has a model, just not the one anything is configured to use.
    """

    installed = ["something-else:7b"]

    def __init__(self, model: str | None = None) -> None:
        self.model = model or get_settings().ollama_model

    async def complete(self, system, user, *, temperature=0.2, max_tokens=None):
        raise NotImplementedError

    async def complete_json(self, system, user, *, temperature=0.1):
        raise NotImplementedError

    async def info(self) -> ModelInfo:
        return ModelInfo(
            provider="fake",
            model=self.model,
            endpoint="fake://tags",
            available=self.model in self.installed,
            detail="",
        )

    async def status(self) -> ProviderStatus:
        return ProviderStatus(
            provider="fake",
            base_url="fake://runtime",
            endpoint="fake://tags",
            reachable=True,
            detail="A fake runtime, for the tests.",
            installed=list(self.installed),
        )

    def install_command(self, model: str) -> str:
        return f"ollama pull {model}"


register_provider("fake", FakeProvider)

from fastapi.testclient import TestClient  # noqa: E402

from app.api.system import DiagnosticsRequest, diagnostics_report  # noqa: E402
from app.main import app as application  # noqa: E402

settings = get_settings()

check("the default model is qwen3:14b", settings.ollama_model == "qwen3:14b", settings.ollama_model)
check("the context window is 16384", settings.ollama_num_ctx == 16384, str(settings.ollama_num_ctx))
check(
    "an unpinned stage runs on the default",
    settings.model_for("scoring") == "qwen3:14b",
    settings.model_for("scoring"),
)
check(
    "a pinned stage runs on its own tag",
    settings.model_for("cover_letter") == "pinned-model:30b",
    settings.model_for("cover_letter"),
)

with TestClient(application) as client:
    payload = client.get("/api/info").json()

    for field in ("app_name", "version", "python", "platform", "data_dir", "port"):
        check(f"/api/info reports {field}", bool(payload.get(field) not in (None, "")), repr(payload.get(field)))

    database = payload.get("database") or {}
    check("/api/info reports the database path", bool(database.get("path")), repr(database))
    check("/api/info says whether the database file exists", "exists" in database)
    check("/api/info reports the database size", isinstance(database.get("size_bytes"), int))
    check(
        "the database file is the one the settings resolve to",
        database.get("path", "").endswith("job_hunter.db"),
        database.get("path", ""),
    )

    logs = payload.get("logs") or {}
    check("/api/info reports the log directory", bool(logs.get("dir")), repr(logs))
    check("/api/info reports today's log file", logs.get("path", "").endswith(".log"), repr(logs))
    check("/api/info says whether the log file exists", "exists" in logs)
    check(
        "the log directory is inside the data directory",
        str(_DATA_DIR) in logs.get("dir", ""),
        logs.get("dir", ""),
    )

    llm = payload.get("llm") or {}
    check("/api/info reports whether the model runtime answered", llm.get("reachable") is True)
    check(
        "/api/info lists the models actually installed",
        llm.get("installed_models") == ["something-else:7b"],
        repr(llm.get("installed_models")),
    )

    stages = {entry["stage"]: entry for entry in llm.get("stages", [])}
    check(
        "/api/info names a model for every stage",
        set(stages) == {stage for stage, _ in LLM_STAGES},
        repr(sorted(stages)),
    )
    check(
        "an unpinned stage reports the default model",
        stages.get("scoring", {}).get("model") == "qwen3:14b",
        repr(stages.get("scoring")),
    )
    check(
        "a pinned stage reports its own model",
        stages.get("cover_letter", {}).get("model") == "pinned-model:30b",
        repr(stages.get("cover_letter")),
    )
    check("a pinned stage is marked as pinned", stages.get("cover_letter", {}).get("pinned") is True)
    check(
        "a configured model that is not installed is reported as missing",
        stages.get("scoring", {}).get("installed") is False,
        repr(stages.get("scoring")),
    )
    check(
        "a missing model carries the command that installs it",
        stages.get("scoring", {}).get("pull_command") == "ollama pull qwen3:14b",
        repr(stages.get("scoring", {}).get("pull_command")),
    )
    check(
        "every missing model is named once",
        llm.get("missing_models") == ["pinned-model:30b", "qwen3:14b"],
        repr(llm.get("missing_models")),
    )

    check("/api/info lists the job sources", isinstance(payload.get("sources"), list))
    check("/api/info says whether any job is stored", isinstance(payload.get("jobs_stored"), bool))

    # -- what the "Copy diagnostics" button produces ---------------------------
    secret_line = "state ready password=hunter2 token=abcdef123456"
    body = "CANDIDATE SUMMARY. Engineer with a decade of delivery experience. " * 30
    report = client.post(
        "/api/diagnostics",
        json={"shell": [secret_line], "log": [f"2026-09-11 10:00:00Z BACKEND stored {body}"]},
    ).json()["text"]

    check("the copied report is text", isinstance(report, str) and len(report) > 0)
    check("the copied report carries no password", "hunter2" not in report, report[:200])
    check("the copied report carries no token", "abcdef123456" not in report, report[:200])
    check("the masking is visible in the copied report", MASK in report)
    check(
        "a document body does not reach the clipboard whole",
        "truncated" in report and report.count("delivery experience") < 10,
        str(report.count("delivery experience")),
    )
    check("the copied report names the missing model", "qwen3:14b" in report)
    check("the copied report carries the pull command", "ollama pull qwen3:14b" in report)
    check("the copied report names the log file", "log file" in report)
    check("the copied report keeps the shell section", "Desktop shell" in report)

# The report is per line, so an ordinary long report is not truncated as a whole.
long_report = asyncio.run(
    diagnostics_report(DiagnosticsRequest(shell=[f"line {index}" for index in range(40)], log=[]))
)
check(
    "a long report is not cut off as one string",
    "line 39" in long_report,
    long_report[-120:],
)


print(f"\n{'=' * 60}")
print(f"{passed} passed, {len(failures)} failed")
if failures:
    sys.exit(1)
print("All unit tests passed.")
