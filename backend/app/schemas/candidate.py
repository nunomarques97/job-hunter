"""Candidate schemas.

The nested shapes are declared rather than left as free-form JSON, so a malformed
import cannot quietly produce a CV with a missing employer name.
"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from .common import ORMModel


class ExperienceEntry(BaseModel):
    title: str = ""
    company: str = ""
    location: str = ""
    start: str = ""
    end: str = ""
    highlights: list[str] = Field(default_factory=list)


class EducationEntry(BaseModel):
    degree: str = ""
    institution: str = ""
    location: str = ""
    start: str = ""
    end: str = ""


class ProjectEntry(BaseModel):
    name: str = ""
    description: str = ""
    url: str = ""
    technologies: list[str] = Field(default_factory=list)


class CertificationEntry(BaseModel):
    name: str = ""
    issuer: str = ""
    year: str = ""


class LanguageEntry(BaseModel):
    name: str = ""
    level: str = ""


class CandidateBase(BaseModel):
    full_name: str = ""
    email: str = ""
    phone: str = ""
    location: str = ""
    country: str = ""
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
    achievements: list[str] = Field(default_factory=list)

    target_roles: list[str] = Field(default_factory=list)
    target_locations: list[str] = Field(default_factory=list)
    target_countries: list[str] = Field(default_factory=list)
    remote_only: bool = False
    accepts_hybrid: bool = True
    accepts_onsite: bool = True
    willing_to_relocate: bool = False
    min_salary: int | None = None
    salary_currency: str = "EUR"
    seniority_targets: list[str] = Field(default_factory=list)

    excluded_companies: list[str] = Field(default_factory=list)
    excluded_keywords: list[str] = Field(default_factory=list)
    excluded_industries: list[str] = Field(default_factory=list)


class CandidateUpdate(CandidateBase):
    pass


class CandidateRead(CandidateBase, ORMModel):
    id: int
    profile_version: int
    created_at: datetime
    updated_at: datetime


class CandidateCompleteness(BaseModel):
    """How ready the profile is, and what is missing.

    The interface uses this to stop the user from generating documents against a
    half-filled profile, which is the most common cause of a poor CV.
    """

    percent: int
    missing: list[str]
    ready_for_generation: bool
