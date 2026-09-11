"""End-to-end smoke test against a running backend.

Walks the product's actual workflow: profile, discover, score, prepare a
package, move it through the pipeline, and read the dashboard. Run it with the
API already listening.

    python tests/smoke_workflow.py [base_url]

The checks are written to pass against a database that already holds data, so
this can be pointed at a real installation without first wiping it.
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8756"

PROFILE = {
    "full_name": "Nuno Marques",
    "email": "nuno@example.com",
    "phone": "+351 912 000 000",
    "location": "Braga, Portugal",
    "country": "Portugal",
    "headline": "Frontend Engineer, Angular and TypeScript",
    "summary": (
        "Frontend engineer with five years building operations tooling in Angular. "
        "Most recent work was a shared component library used across four product teams."
    ),
    "years_of_experience": 5,
    "current_role": "Frontend Engineer",
    "experience": [
        {
            "title": "Frontend Engineer",
            "company": "Vodafone",
            "location": "Porto, Portugal",
            "start": "2021",
            "end": "2025",
            "highlights": [
                "Built the Angular component library adopted by four product teams.",
                "Brought the operations console to WCAG AA.",
            ],
        },
        {
            "title": "Junior Developer",
            "company": "Altice Labs",
            "location": "Aveiro, Portugal",
            "start": "2019",
            "end": "2021",
            "highlights": ["Maintained internal reporting tools in Angular and .NET."],
        },
    ],
    "education": [
        {
            "degree": "BSc Computer Engineering",
            "institution": "Universidade do Minho",
            "start": "2015",
            "end": "2019",
        }
    ],
    "skills": ["Accessibility", "Code review", "Mentoring"],
    "technologies": [
        "Angular", "TypeScript", "RxJS", "NgRx", "CSS", "HTML", "Git", "Jest", "Docker",
    ],
    "target_roles": ["Frontend Engineer", "Frontend Developer", "Full Stack Developer"],
    "target_locations": ["Porto", "Braga", "Lisbon"],
    "target_countries": ["Portugal", "Spain"],
    "remote_only": False,
    "accepts_hybrid": True,
    "accepts_onsite": True,
    "willing_to_relocate": False,
    "min_salary": 45000,
    "salary_currency": "EUR",
    "seniority_targets": ["mid", "senior"],
}

passed = 0
failed: list[str] = []


def call(method: str, path: str, payload=None, timeout: float = 600.0):
    """One API call, returning (status, parsed body)."""
    url = f"{BASE}{path}"
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(url, data=data, method=method)
    if data:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode()
            if not body:
                return response.status, None
            try:
                return response.status, json.loads(body)
            except json.JSONDecodeError:
                # Exports return Markdown, text or HTML rather than JSON.
                return response.status, body
    except urllib.error.HTTPError as exc:
        body = exc.read().decode()
        try:
            return exc.code, json.loads(body)
        except json.JSONDecodeError:
            return exc.code, body


def check(label: str, condition: bool, detail: str = "") -> None:
    global passed
    if condition:
        passed += 1
        print(f"  PASS  {label}" + (f"  ({detail})" if detail else ""))
    else:
        failed.append(label)
        print(f"  FAIL  {label}  {detail}")


def main() -> None:
    print(f"Job Hunter smoke test against {BASE}\n")

    print("Health")
    status, health = call("GET", "/api/health")
    check("health responds", status == 200, f"status={status}")
    check("database healthy", health["database"]["status"] == "healthy", str(health["database"]))
    check("11 tables present", health["database"].get("tables") == 11, str(health["database"].get("tables")))
    print(f"  info  model: {health['llm']['model']} ({health['llm']['status']})")

    print("\nProfile")
    status, _ = call("PUT", "/api/profile/", PROFILE)
    check("profile saves", status == 200, f"status={status}")
    status, completeness = call("GET", "/api/profile/completeness")
    check("profile complete", completeness["ready_for_generation"], str(completeness["missing"]))
    status, master = call("GET", "/api/profile/master-cv")
    check("master CV renders from profile", "Vodafone" in master["content"], f"{len(master['content'])} chars")
    check(
        "master CV invents nothing",
        "Google" not in master["content"] and "Kubernetes" not in master["content"],
    )

    print("\nDiscovery")
    status, discovery = call("POST", "/api/jobs/discover", {"sources": ["sample"], "terms": []})
    check("sample source discovers", status == 200 and discovery["fetched"] == 5, str(discovery.get("fetched")))
    status, again = call("POST", "/api/jobs/discover", {"sources": ["sample"], "terms": []})
    check("rediscovery creates no duplicates", again["created"] == 0, f"created={again['created']}, updated={again['updated']}")

    status, jobs = call("GET", "/api/jobs/?page_size=100")
    check("jobs list returns", status == 200 and jobs["total"] > 0, f"total={jobs['total']}")

    status, facets = call("GET", "/api/jobs/facets")
    check("facets populated", len(facets["technologies"]) > 0, f"{len(facets['technologies'])} technologies")
    junk = {"engineer", "digital nomad", "exec", "customer support", "dev"}
    named = {item["value"].lower() for item in facets["technologies"]}
    check("facets hold technologies, not free-form tags", not (named & junk), str(sorted(named & junk)))

    sample_jobs = [item for item in jobs["items"] if item["source"] == "sample"]
    angular_job = next((item for item in sample_jobs if "Angular" in item["title"]), sample_jobs[0])

    print("\nScoring")
    started = time.time()
    status, scored = call("POST", f"/api/jobs/{angular_job['id']}/score?use_model=true")
    elapsed = time.time() - started
    check("job scores", status == 200 and scored["score"] is not None, f"status={status}")
    score = scored["score"]
    check("score in range", 0 <= score["score"] <= 100, f"score={score['score']}")
    check("breakdown explains the score", len(score["breakdown"]) >= 6, str(list(score["breakdown"])))
    check("matched skills found", len(score["matched_skills"]) > 0, str(score["matched_skills"][:5]))
    print(f"  info  score={score['score']} method={score['method']} confidence={score['confidence']} in {elapsed:.1f}s")

    status, unscored = call("POST", f"/api/jobs/{angular_job['id']}/score?use_model=false")
    check("deterministic path works without model", unscored["score"]["method"] == "deterministic")

    print("\nApplication package")
    started = time.time()
    status, package = call("POST", f"/api/applications/{angular_job['id']}/prepare", {"regenerate": True})
    elapsed = time.time() - started
    check("package prepares", status == 200, f"status={status} {str(package)[:160]}")
    if status != 200:
        report()
        return

    application = package["application"]
    check("CV generated", application["tailored_cv"] is not None)
    check("cover letter generated", application["cover_letter"] is not None)
    cv = application["tailored_cv"]
    letter = application["cover_letter"]
    print(
        f"  info  cv: {cv['word_count']} words via {cv['generated_by']}, "
        f"letter: {letter['word_count']} words via {letter['generated_by']}, in {elapsed:.1f}s"
    )
    check("CV keeps a real employer", "Vodafone" in cv["content"], "employer preserved")
    check(
        "truthfulness recorded",
        isinstance(cv["truthfulness_passed"], bool),
        f"cv={cv['truthfulness_passed']} letter={letter['truthfulness_passed']}",
    )
    if not cv["truthfulness_passed"]:
        print(f"  info  CV findings: {cv['truthfulness_findings']}")
    check(
        "stage reflects outcome",
        application["stage"] in ("prepared", "action_required"),
        application["stage"],
    )

    print("\nPipeline")
    application_id = application["id"]
    status, moved = call(
        "PATCH", f"/api/applications/{application_id}/stage", {"stage": "submitted", "reason": "Sent by hand."}
    )
    check("stage change works", status == 200 and moved["stage"] == "submitted", moved.get("stage"))
    check("submitted_at recorded", moved["submitted_at"] is not None)
    check("stage history kept", len(moved["stage_history"]) >= 2, f"{len(moved['stage_history'])} entries")

    status, board = call("GET", "/api/applications/board")
    check("board returns 11 columns", len(board["columns"]) == 11, str(len(board["columns"])))
    submitted_column = next(column for column in board["columns"] if column["stage"] == "submitted")
    check(
        "application appears in its column",
        any(item["id"] == application_id for item in submitted_column["items"]),
        f"{submitted_column['count']} in the column",
    )

    print("\nDocuments")
    status, versions = call("GET", f"/api/documents/{cv['id']}/versions")
    check("version history available", status == 200 and len(versions) >= 1, f"{len(versions)} versions")
    check("regeneration kept the previous version", len(versions) >= 2, f"{len(versions)} versions")
    status, _ = call("GET", f"/api/documents/{cv['id']}/export?fmt=md")
    check("markdown export works", status == 200)

    print("\nAutomation")
    status, state = call("GET", "/api/automation/state")
    check("automation state reads", status == 200, f"status={status}")
    check("dry run on by default", state["config"]["dry_run"] is True)
    status, stopped = call("POST", "/api/automation/emergency-stop?engage=true")
    check("emergency stop engages", stopped["config"]["emergency_stop"] is True)
    status, _ = call("POST", "/api/automation/run")
    check("emergency stop blocks a run", status == 409, f"status={status}")
    call("POST", "/api/automation/emergency-stop?engage=false")

    print("\nAnalytics")
    status, dashboard = call("GET", "/api/analytics/dashboard")
    check("dashboard responds", status == 200, f"status={status}")
    check(
        "dashboard has every panel",
        all(
            key in dashboard
            for key in ("overview", "pipeline", "daily", "recent_matches", "automation", "activity", "insights")
        ),
        str(sorted(dashboard)),
    )
    check("daily series is 30 days", len(dashboard["daily"]) == 30, str(len(dashboard["daily"])))
    check("pipeline has 11 stages", len(dashboard["pipeline"]) == 11)
    status, funnel = call("GET", "/api/analytics/funnel")
    check("funnel computes", len(funnel) == 7, str(len(funnel)))

    print("\nEmail")
    status, templates = call("GET", "/api/email/templates")
    check("builtin templates seeded", len(templates) >= 3, f"{len(templates)} templates")
    status, _ = call(
        "POST", "/api/email/accounts", {"address": "a@b.com", "provider": "smtp", "password": "hunter2"}
    )
    check("credentials in the payload are rejected", status == 422, f"status={status}")

    print("\nActivity")
    status, activity = call("GET", "/api/analytics/activity")
    check("activity log populated", len(activity) > 0, f"{len(activity)} entries")

    report()


def report() -> None:
    print(f"\n{'=' * 60}")
    print(f"{passed} passed, {len(failed)} failed")
    if failed:
        for name in failed:
            print(f"  failed: {name}")
        sys.exit(1)
    print("All smoke checks passed.")


if __name__ == "__main__":
    main()
