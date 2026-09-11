"""A deterministic offline source.

This exists so the product has a working demo without a network, and so tests
have fixed input. Its jobs are clearly labelled as samples in the interface and
carry no application URL, so nothing here can ever be submitted by accident.
"""
from __future__ import annotations

from datetime import timedelta

from ..db.base import utcnow
from ..models.enums import ApplicationMethod, RemoteType, Seniority
from .base import DiscoveryQuery, JobSource, RawJob, SourceCapabilities

_POSTINGS = [
    {
        "title": "Senior Frontend Engineer (Angular)",
        "company": "Northwind Systems",
        "location": "Lisbon, Portugal",
        "remote_type": RemoteType.HYBRID,
        "seniority": Seniority.SENIOR,
        "technologies": ["Angular", "TypeScript", "RxJS", "NgRx", "Jest", "Azure DevOps"],
        "salary": (55000, 72000, "EUR"),
        "age_days": 0,
        "description": (
            "We are building the operations console used by our logistics customers "
            "across Iberia. The frontend is Angular with NgRx, talking to a .NET API.\n\n"
            "You will own the component library, drive accessibility to WCAG AA, and "
            "work directly with two designers."
        ),
        "requirements": (
            "- 5+ years building production single-page applications\n"
            "- Deep Angular experience, including change detection and RxJS\n"
            "- Comfortable with TypeScript strict mode\n"
            "- Experience with component testing\n"
            "- Working Portuguese or English"
        ),
    },
    {
        "title": "Full Stack Developer (.NET + Angular)",
        "company": "Cartograph Labs",
        "location": "Porto, Portugal",
        "remote_type": RemoteType.HYBRID,
        "seniority": Seniority.MID,
        "technologies": ["C#", ".NET", "Angular", "SQL Server", "Docker", "Azure"],
        "salary": (42000, 58000, "EUR"),
        "age_days": 1,
        "description": (
            "Cartograph Labs builds mapping tools for civil engineering firms. The "
            "stack is .NET 8 on the server and Angular on the client.\n\n"
            "This is a product team of six. You would be the fourth engineer."
        ),
        "requirements": (
            "- 3+ years with C# and .NET\n"
            "- Angular or another modern SPA framework\n"
            "- Relational database design\n"
            "- Docker and a CI pipeline"
        ),
    },
    {
        "title": "Frontend Engineer, Design Systems",
        "company": "Halcyon",
        "location": "Remote (EU)",
        "remote_type": RemoteType.REMOTE,
        "seniority": Seniority.SENIOR,
        "technologies": ["React", "TypeScript", "CSS", "Storybook", "Figma"],
        "salary": (70000, 95000, "EUR"),
        "age_days": 2,
        "description": (
            "Halcyon is a fully remote company across the EU. The design systems team "
            "owns the component library that every product team builds on.\n\n"
            "You would work closely with brand and accessibility."
        ),
        "requirements": (
            "- Strong CSS, including modern layout and theming\n"
            "- React and TypeScript in production\n"
            "- Experience maintaining a shared component library\n"
            "- Accessibility to WCAG AA"
        ),
    },
    {
        "title": "Platform Engineer",
        "company": "Rivermark",
        "location": "Madrid, Spain",
        "remote_type": RemoteType.ONSITE,
        "seniority": Seniority.MID,
        "technologies": ["Go", "Kubernetes", "Terraform", "AWS", "PostgreSQL"],
        "salary": (48000, 66000, "EUR"),
        "age_days": 3,
        "description": (
            "Rivermark runs the payments infrastructure for several Iberian retailers. "
            "The platform team owns the Kubernetes estate and the deployment pipeline."
        ),
        "requirements": (
            "- Go or another systems language\n"
            "- Kubernetes in production\n"
            "- Infrastructure as code\n"
            "- On-call experience"
        ),
    },
    {
        "title": "Junior Software Engineer",
        "company": "Meridian Health",
        "location": "Braga, Portugal",
        "remote_type": RemoteType.ONSITE,
        "seniority": Seniority.JUNIOR,
        "technologies": ["Java", "Spring", "MySQL"],
        "salary": (24000, 32000, "EUR"),
        "age_days": 5,
        "description": (
            "Meridian Health builds scheduling software for private clinics. This is a "
            "first or second role, with a structured mentoring programme."
        ),
        "requirements": (
            "- A degree in computing or equivalent practical experience\n"
            "- Java fundamentals\n"
            "- Willingness to learn Spring"
        ),
    },
]


class SampleSource(JobSource):
    name = "sample"
    label = "Sample data"

    def capabilities(self) -> SourceCapabilities:
        return SourceCapabilities(
            can_submit=False,
            note=(
                "Fixed demonstration postings for trying the product offline. "
                "These are not real vacancies and carry no application link."
            ),
        )

    async def fetch(self, query: DiscoveryQuery) -> list[RawJob]:
        now = utcnow()
        jobs: list[RawJob] = []
        for index, posting in enumerate(_POSTINGS):
            if not query.matches_text(
                posting["title"], posting["company"], " ".join(posting["technologies"])
            ):
                continue
            salary_min, salary_max, currency = posting["salary"]
            jobs.append(
                RawJob(
                    source=self.name,
                    source_job_id=f"sample-{index}",
                    title=posting["title"],
                    company=posting["company"],
                    canonical_url="",
                    application_url="",
                    application_method=ApplicationMethod.MANUAL,
                    location=posting["location"],
                    remote_type=posting["remote_type"],
                    employment_type="full-time",
                    description=posting["description"],
                    requirements=posting["requirements"],
                    technologies=list(posting["technologies"]),
                    salary_min=salary_min,
                    salary_max=salary_max,
                    salary_currency=currency,
                    posted_at=now - timedelta(days=posting["age_days"]),
                    raw_payload={"sample": True, "seniority": posting["seniority"]},
                )
            )
        return jobs
