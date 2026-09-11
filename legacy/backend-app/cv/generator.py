"""
CV and Cover Letter Generator for Job Hunter
"""
from typing import Dict, Any, List, Optional
from ..llm import get_llm_provider
import logging

logger = logging.getLogger(__name__)

class CVGenerator:
    """Generates CVs and cover letters using LLMs"""
    
    def __init__(self):
        self.llm_provider = get_llm_provider()
    
    async def generate_cv(self, candidate_profile: Dict[str, Any], job_description: str = "") -> str:
        """Generate a tailored CV based on candidate profile and job description"""
        try:
            prompt = f"""
            Create a professional CV for a candidate with the following details:
            
            Profile: {candidate_profile}
            
            Job Description: {job_description}
            
            Please format this as a clean, professional CV in Markdown format that includes:
            - Candidate name
            - Contact information 
            - Professional summary
            - Skills and technologies
            - Work experience (formatted with dates, company, role, achievements)
            - Education
            - Certifications
            
            Make it tailored for the job description but keep the overall tone professional and concise.
            """
            
            # Generate CV content using LLM
            cv_content = await self.llm_provider.generate_text(prompt)
            return cv_content
            
        except Exception as e:
            logger.error(f"Error generating CV: {str(e)}")
            raise
    
    async def generate_cover_letter(self, candidate_profile: Dict[str, Any], 
                                   job_description: str, company_name: str = "") -> str:
        """Generate a tailored cover letter for a specific job"""
        try:
            prompt = f"""
            Create a professional cover letter for the following candidate applying to {company_name}:
            
            Candidate Profile: {candidate_profile}
            
            Job Description: {job_description}
            
            Company: {company_name}
            
            Please format this as a standard 3-paragraph cover letter that:
            - Opens with a strong hook
            - Highlights relevant experience and skills 
            - Demonstrates knowledge of the company
            - Shows enthusiasm for the role
            - Concludes with a polite call to action
            
            Format the output in Markdown.
            """
            
            # Generate cover letter using LLM
            cover_letter = await self.llm_provider.generate_text(prompt)
            return cover_letter
            
        except Exception as e:
            logger.error(f"Error generating cover letter: {str(e)}")
            raise