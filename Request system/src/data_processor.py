"""
Data processing functions for SPUP REC System
"""
import csv
import io

# Import config values - handle both relative and absolute imports
try:
    from .config import REVIEWERS_LIST
except ImportError:
    from config import REVIEWERS_LIST


def read_csv_file(uploaded_file):
    """Read CSV file and return data as list of dictionaries"""
    try:
        content = uploaded_file.read().decode('utf-8')
        lines = content.split('\n')
        
        if not lines:
            return None, "File is empty"
        
        reader = csv.DictReader(lines)
        data = []
        for row in reader:
            if any(row.values()):
                data.append(row)
        
        return data, None
    except Exception as e:
        return None, f"Error reading file: {str(e)}"


def parse_csv_text(csv_text):
    """Parse CSV text and return data as list of dictionaries"""
    try:
        if not csv_text.strip():
            return None, "No data provided"
        
        # Use StringIO to treat the text as a file
        csv_file = io.StringIO(csv_text.strip())
        reader = csv.DictReader(csv_file)
        
        data = []
        for row in reader:
            if any(row.values()):  # Skip empty rows
                data.append(row)
        
        if not data:
            return None, "No valid data rows found"
        
        return data, None
    except Exception as e:
        return None, f"Error parsing CSV data: {str(e)}"


def create_summary_from_data(data, amount_per_review):
    """Create summary from data"""
    if not data:
        return None, "No data to process"
    
    reviewer_columns = ['Reviewer #1', 'Reviewer #2', 'Reviewer #3']
    if not all(col in data[0].keys() for col in reviewer_columns):
        return None, f"Missing required columns: {reviewer_columns}"
    
    reviewer_counts = {}
    
    for row in data:
        for col in reviewer_columns:
            reviewer = row.get(col, '').strip()
            if reviewer:
                if reviewer in reviewer_counts:
                    reviewer_counts[reviewer] += 1
                else:
                    reviewer_counts[reviewer] = 1
    
    summary_data = []
    for reviewer, count in reviewer_counts.items():
        summary_data.append({
            'Name of Reviewers': reviewer,
            'Number of Required Proposals': count,
            'Honorarium (₱500 Per Proposal)': f"₱{count * amount_per_review:,.2f}"
        })
    
    summary_data.sort(key=lambda x: x['Number of Required Proposals'], reverse=True)
    
    return summary_data, None


def validate_reviewers(data):
    """Validate reviewers against known list"""
    if not data:
        return [], []
    
    all_reviewers = set()
    reviewer_columns = ['Reviewer #1', 'Reviewer #2', 'Reviewer #3']
    
    for row in data:
        for col in reviewer_columns:
            reviewer = row.get(col, '').strip()
            if reviewer:
                all_reviewers.add(reviewer)
    
    unknown_reviewers = [r for r in all_reviewers if r not in REVIEWERS_LIST]
    return list(all_reviewers), unknown_reviewers


def create_sample_csv():
    """Create sample CSV data for the user"""
    sample_data = """OR,SPUP REC Code,Principal Investigator,Research Title,Course/Program,Reviewer #1,Reviewer #2,Reviewer #3
2393487,SPUP_2025_00160_SR_MG,Mevic Chea S. Gacuya,Sample Research Title 1,BPEd,Mr. Rogelio Fermin,Mrs. Rita B. Daliwag,Mrs. Maria Felina B. Agbayani
2374628,SPUP_2024_0938_EX_JX,Andrei Vincent Rosales Corpuz,Sample Research Title 2,BS Pharma,Mrs. Kristine Joy O. Cortes,Mrs. Jean Sumait,Mrs. Rita B. Daliwag
2374160,SPUP_2025_00018_EX_DA,Diosalind Jeannezsa Ave,Sample Research Title 3,BS Pharma,Mrs. Kristine Joy O. Cortes,Mrs. Jean Sumait,Mrs. Rita B. Daliwag"""
    return sample_data

