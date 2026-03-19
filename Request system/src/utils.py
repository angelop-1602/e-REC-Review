"""
Utility functions for SPUP REC System
"""
import os
import base64
from datetime import datetime, date

# Import config values - handle both relative and absolute imports
try:
    from .config import AMOUNT_UNDERGRADUATE, AMOUNT_GRADUATE, OUTPUT_DIR
except ImportError:
    from config import AMOUNT_UNDERGRADUATE, AMOUNT_GRADUATE, OUTPUT_DIR


def calculate_amount(level):
    """Calculate amount based on education level in pesos"""
    return AMOUNT_UNDERGRADUATE if level == "Undergraduate" else AMOUNT_GRADUATE


def format_currency(amount):
    """Format amount as peso currency"""
    return f"₱{amount:,.2f}"


def get_download_link(file_path, link_text=None):
    """Create download link for file"""
    try:
        with open(file_path, "rb") as file:
            contents = file.read()
        b64 = base64.b64encode(contents).decode()
        filename = os.path.basename(file_path)
        if link_text is None:
            link_text = f"📥 Download {filename}"
        href = f'<a href="data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,{b64}" download="{filename}">{link_text}</a>'
        return href
    except Exception as e:
        return f"Error creating download link: {str(e)}"


def generate_output_filename(prefix="Generated_Letter", extension=".docx"):
    """Generate a unique output filename with timestamp"""
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f"{prefix}_{timestamp}{extension}"
    # Ensure output directory exists
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    return os.path.join(OUTPUT_DIR, filename)


def format_date(date_obj, format_string="%B %d, %Y"):
    """Format date object to string"""
    if isinstance(date_obj, date):
        return date_obj.strftime(format_string)
    return str(date_obj)


def ensure_output_dir():
    """Ensure output directory exists"""
    os.makedirs(OUTPUT_DIR, exist_ok=True)

