"""
Configuration file for SPUP REC System
Contains shared constants and configuration values
"""

# List of all possible reviewers in the desired order
REVIEWERS_LIST = [
    "Dr. Allan Paulo L. Blaquera", "Dr. Nova R. Domingo", "Dr. Claudeth U. Gamiao",
    "Dr. Mark Klimson L. Luyun", "Mr. Wilfredo DJ P. Martin IV", "Mr. Sergio G. Imperio",
    "Dr. Marjorie L. Bambalan", "Mrs. Elizabeth C. Iquin", "Dr. Milrose Tangonan",
    "Engr. Verge C. Baccay", "Mr. Everett T. Laureta", "Mrs. Maria Felina B. Agbayani",
    "Mrs. Rita B. Daliwag", "Mrs. Lita Jose", "Dr. Corazon Dela Cruz", "Dr. Ester Yu",
    "Mr. Angelo Peralta", "Dr. Janette Fermin", "Mr. Rogelio Fermin", "Mrs. Vivian Sorita",
    "Dr. Benjamin Jularbal", "Mrs. Kristine Joy O. Cortes", "Mrs. Jean Sumait",
    "Dr. Emman Earl Cacayurin", "Dr. Marites Tenedor", "Dr. MJ Manuel", "Mr. John Cabullo"
]

# Month names
MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
]

# File paths (relative to project root)
import os
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE_LETTER = os.path.join(PROJECT_ROOT, "templates", "Letter_Template.docx")
TEMPLATE_VOUCHER = os.path.join(PROJECT_ROOT, "templates", "Template_Voucher.docx")
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "output")

# Amounts per review
AMOUNT_UNDERGRADUATE = 300
AMOUNT_GRADUATE = 500

