"""
Entry point for Streamlit application
This file is at the root level to allow Streamlit to run properly
"""
import streamlit as st
from datetime import date
import os
import sys

# Add src directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

# Import from local modules
from config import REVIEWERS_LIST, MONTHS, TEMPLATE_LETTER
from utils import calculate_amount, format_currency, get_download_link, ensure_output_dir
from data_processor import (
    read_csv_file, parse_csv_text, create_summary_from_data,
    validate_reviewers, create_sample_csv
)
from document_generator import create_letter_document
from voucher_generator import create_voucher_document

# Ensure output directory exists
ensure_output_dir()

# Page configuration
st.set_page_config(
    page_title="SPUP REC - Letter & Voucher Creation System",
    page_icon="📄",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom CSS
st.markdown("""
<style>
    .main-header {
        font-size: 2.5rem;
        color: #1f77b4;
        text-align: center;
        margin-bottom: 2rem;
        padding: 1rem;
        background: linear-gradient(90deg, #f0f2f6, #ffffff);
        border-radius: 10px;
    }
    .section-header {
        font-size: 1.5rem;
        color: #333;
        margin-top: 2rem;
        margin-bottom: 1rem;
        padding: 0.5rem;
        background-color: #f8f9fa;
        border-left: 4px solid #1f77b4;
    }
    .csv-input {
        font-family: monospace;
        font-size: 12px;
    }
</style>
""", unsafe_allow_html=True)


def display_data_as_table(data, title, max_rows=10):
    """Display data as HTML table"""
    if not data:
        st.write("No data to display")
        return
    
    st.write(f"**{title}**")
    
    headers = list(data[0].keys())
    
    html = "<table style='width:100%; border-collapse: collapse; font-size: 12px;'>"
    
    html += "<tr style='background-color: #f0f2f6;'>"
    for header in headers:
        html += f"<th style='border: 1px solid #ddd; padding: 8px; text-align: center; font-weight: bold;'>{header}</th>"
    html += "</tr>"
    
    for row in data[:max_rows]:
        html += "<tr>"
        for header in headers:
            value = row.get(header, '')
            html += f"<td style='border: 1px solid #ddd; padding: 8px; text-align: center;'>{value}</td>"
        html += "</tr>"
    
    html += "</table>"
    
    if len(data) > max_rows:
        st.write(f"Showing first {max_rows} of {len(data)} rows")
    
    st.markdown(html, unsafe_allow_html=True)


def main():
    # Main header
    st.markdown('<div class="main-header">📄 SPUP REC - Letter & Voucher Creation System</div>', unsafe_allow_html=True)
    
    # Sidebar navigation
    st.sidebar.title("🧭 Navigation")
    page = st.sidebar.selectbox("Choose a section", [
        "Letter Generation", 
        "Voucher Creation",
        "Reviewer Management", 
        "Help & Documentation"
    ])
    
    if page == "Letter Generation":
        col1, col2 = st.columns([1, 1])
        
        with col1:
            st.markdown('<div class="section-header">📅 Letter Details</div>', unsafe_allow_html=True)
            
            # Date input
            date_today = st.date_input(
                "Select Date",
                value=date.today(),
                help="Select the date for the letter"
            )
            
            # Level selection
            level = st.selectbox(
                "Education Level",
                ["Undergraduate", "Graduate"],
                help="Select the education level for amount calculation"
            )
            
            # Month-Year input with dropdowns
            st.write("**Data Collection Period:**")
            col_month1, col_month2, col_year = st.columns([1, 1, 1])
            
            with col_month1:
                start_month = st.selectbox("From Month", MONTHS, index=0)
            
            with col_month2:
                end_month = st.selectbox("To Month", MONTHS, index=2)
            
            with col_year:
                current_year = date.today().year
                year = st.selectbox("Year", range(current_year-2, current_year+3), index=2)
            
            # Format as words: "January-March, 2025"
            month_year_display = f"{start_month}-{end_month}, {year}"
            
            st.info(f"📅 Period: {month_year_display}")
            
            # Display amount
            amount = calculate_amount(level)
            st.info(f"💰 Amount per review: {format_currency(amount)}")
        
        with col2:
            st.markdown('<div class="section-header">📊 Data Input</div>', unsafe_allow_html=True)
            
            # Data input method selection
            input_method = st.radio(
                "Choose data input method:",
                ["📄 Upload CSV File", "📝 Paste CSV Data"],
                horizontal=True
            )
            
            data = None
            error = None
            
            if input_method == "📄 Upload CSV File":
                # File upload
                uploaded_file = st.file_uploader(
                    "Upload CSV file",
                    type=['csv'],
                    help="Upload your CSV file with reviewer data"
                )
                
                if uploaded_file is not None:
                    data, error = read_csv_file(uploaded_file)
            
            else:  # Paste CSV Data
                st.write("**Paste your CSV data below:**")
                
                # Sample data button
                if st.button("📋 Load Sample Data", help="Click to load sample CSV data"):
                    st.session_state.csv_input = create_sample_csv()
                
                # CSV text area
                csv_text = st.text_area(
                    "CSV Data (with headers):",
                    value=st.session_state.get('csv_input', ''),
                    height=200,
                    placeholder="OR,SPUP REC Code,Principal Investigator,Research Title,Course/Program,Reviewer #1,Reviewer #2,Reviewer #3\n2393487,SPUP_2025_00160_SR_MG,Mevic Chea S. Gacuya,Sample Research Title,BPEd,Mr. Rogelio Fermin,Mrs. Rita B. Daliwag,Mrs. Maria Felina B. Agbayani",
                    help="Paste your CSV data here. Make sure to include headers in the first row.",
                    key="csv_input"
                )
                
                # Process CSV button
                if st.button("🔄 Process CSV Data", type="primary"):
                    if csv_text.strip():
                        data, error = parse_csv_text(csv_text)
                    else:
                        error = "Please paste CSV data first"
            
            # Template check
            if os.path.exists(TEMPLATE_LETTER):
                st.success("✅ Letter template found")
            else:
                st.error(f"❌ Letter template not found: {TEMPLATE_LETTER}")
        
        # Process data (from either upload or paste)
        if data is not None:
            st.markdown('<div class="section-header">📋 Data Processing</div>', unsafe_allow_html=True)
            
            if error:
                st.error(f"❌ {error}")
            else:
                # Store data in session state for voucher creation
                st.session_state.data = data
                st.session_state.month_year_display = month_year_display
                st.session_state.amount = amount
                
                display_data_as_table(data, "Complete List of Applications", max_rows=10)
                
                _, unknown_reviewers = validate_reviewers(data)
                
                if unknown_reviewers:
                    st.warning(f"⚠️ Found {len(unknown_reviewers)} unknown reviewer(s):")
                    for reviewer in unknown_reviewers:
                        st.write(f"• {reviewer}")
                else:
                    st.success("✅ All reviewers validated successfully!")
                
                summary_data, summary_error = create_summary_from_data(data, amount)
                
                if summary_error:
                    st.error(f"❌ {summary_error}")
                elif summary_data:
                    st.markdown('<div class="section-header">📈 Summary Statistics</div>', unsafe_allow_html=True)
                    
                    col1, col2, col3, col4 = st.columns(4)
                    with col1:
                        st.metric("Total Applications", len(data))
                    with col2:
                        st.metric("Active Reviewers", len(summary_data))
                    with col3:
                        total_reviews = sum(item['Number of Required Proposals'] for item in summary_data)
                        st.metric("Total Reviews", total_reviews)
                    with col4:
                        grand_total = sum(float(item['Honorarium (₱500 Per Proposal)'].replace('₱', '').replace(',', '')) for item in summary_data)
                        st.metric("Grand Total", format_currency(grand_total))
                    
                    display_data_as_table(summary_data, "Summary of Reviewers")
                    
                    # Generate letter button
                    if st.button("🔄 Generate Letter", type="primary", use_container_width=True):
                        success, output_path, message = create_letter_document(
                            date_today, level, month_year_display, amount, data, summary_data
                        )
                        
                        if success:
                            st.success("✅ Letter generated successfully!")
                            download_link = get_download_link(output_path)
                            st.markdown(download_link, unsafe_allow_html=True)
                            st.info(f"📊 Generated letter with {len(data)} applications and {len(summary_data)} reviewers")
                        else:
                            st.error(f"❌ {message}")
        
        elif error:
            st.error(f"❌ {error}")
    
    elif page == "Voucher Creation":
        st.markdown('<div class="section-header">🧾 Voucher Creation</div>', unsafe_allow_html=True)
        
        if hasattr(st.session_state, 'data') and st.session_state.data:
            st.success("✅ Data loaded from Letter Generation")
            
            st.info(f"📅 Period: {st.session_state.month_year_display}")
            st.info(f"💰 Amount per review: {format_currency(st.session_state.amount)}")
            
            # Show reviewer summary for vouchers
            summary_data, _ = create_summary_from_data(st.session_state.data, st.session_state.amount)
            
            if summary_data:
                st.markdown("### Vouchers to be Generated:")
                display_data_as_table(summary_data, "Reviewer Voucher Summary")
                
                if st.button("🧾 Generate All Vouchers", type="primary", use_container_width=True):
                    success, filename, message = create_voucher_document(
                        st.session_state.data, 
                        st.session_state.month_year_display, 
                        st.session_state.amount
                    )
                    
                    if success:
                        st.success(f"✅ {message}")
                        download_link = get_download_link(filename)
                        st.markdown(download_link, unsafe_allow_html=True)
                        st.info(f"📊 Generated vouchers for {len(summary_data)} reviewers")
                    else:
                        st.error(f"❌ {message}")
        else:
            st.warning("⚠️ No data available. Please input data in Letter Generation first.")
            st.info("👆 Go to Letter Generation tab and either upload a CSV file or paste CSV data to enable voucher creation.")
    
    elif page == "Reviewer Management":
        st.markdown('<div class="section-header">👥 Reviewer Management</div>', unsafe_allow_html=True)
        
        st.markdown("### Registered Reviewers")
        st.info(f"Total registered reviewers: {len(REVIEWERS_LIST)}")
        
        for i, reviewer in enumerate(REVIEWERS_LIST, 1):
            st.write(f"{i}. {reviewer}")
        
        search_term = st.text_input("🔍 Search Reviewers")
        if search_term:
            filtered = [r for r in REVIEWERS_LIST if search_term.lower() in r.lower()]
            if filtered:
                st.success(f"Found {len(filtered)} matching reviewer(s):")
                for reviewer in filtered:
                    st.write(f"• {reviewer}")
            else:
                st.warning("No matching reviewers found.")
    
    elif page == "Help & Documentation":
        st.markdown('<div class="section-header">📚 Help & Documentation</div>', unsafe_allow_html=True)
        
        st.markdown("""
        ### SPUP REC Letter & Voucher Creation System
        
        This integrated system handles both letter generation and voucher creation for the Research Ethics Committee.
        
        #### Letter Generation:
        1. **📅 Select Date**: Choose the date for your letter
        2. **🎓 Choose Education Level**: Undergraduate (₱300) or Graduate (₱500)
        3. **📅 Select Period**: Choose start month, end month, and year using dropdowns
        4. **📊 Input Data**: Either upload CSV file OR paste CSV data directly
        5. **👀 Review Data**: Check preview and summary tables
        6. **🔄 Generate Letter**: Creates Word document with formatted tables
        
        #### Data Input Options:
        - **📄 Upload CSV File**: Traditional file upload method
        - **📝 Paste CSV Data**: Paste data directly into text area
        - **📋 Sample Data Button**: Load example data to get started
        
        #### Voucher Creation:
        1. **Input data** in Letter Generation first (upload or paste)
        2. **Switch to Voucher Creation** tab
        3. **Review voucher summary** for all reviewers
        4. **Generate vouchers** - creates individual voucher pages for each reviewer
        
        ### File Format Example:
        ```
        OR,SPUP REC Code,Principal Investigator,Research Title,Course/Program,Reviewer #1,Reviewer #2,Reviewer #3
        2393487,SPUP_2025_00160_SR_MG,Mevic Chea S. Gacuya,Sample Research Title,BPEd,Mr. Rogelio Fermin,Mrs. Rita B. Daliwag,Mrs. Maria Felina B. Agbayani
        2374628,SPUP_2024_0938_EX_JX,Andrei Vincent Rosales Corpuz,Another Research Title,BS Pharma,Mrs. Kristine Joy O. Cortes,Mrs. Jean Sumait,Mrs. Rita B. Daliwag
        ```
        
        ### Key Features:
        - **Word format periods**: "January-March, 2025" instead of "01-03,2025"
        - **Peso currency**: All amounts in ₱ (pesos)
        - **Professional formatting**: Tables with proper styling
        - **Integrated workflow**: Generate both letters and vouchers from same data
        - **Flexible data input**: Upload files OR paste data directly
        - **Sample data**: Click button to load example data
        - **Reviewer validation**: Checks against registered reviewers
        - **Individual vouchers**: Separate voucher page for each reviewer
        
        ### Quick Start:
        1. Go to **Letter Generation**
        2. Click **📋 Load Sample Data** to see the format
        3. Replace with your actual data or upload your CSV file
        4. Click **🔄 Process CSV Data** (if pasting) or let file upload process automatically
        5. Generate letter and/or vouchers
        
        ### Template Placeholders:
        - `<<Date_Today>>`: Selected date in full format
        - `<<Level>>`: Education level (Undergraduate/Graduate)
        - `<<Month_Year>>`: Period in word format (e.g., "January-March, 2025")
        - `<<Amount>>`: Amount per review in pesos
        - `<<Complete_List_Table>>`: Formatted complete data table
        - `<<Summary_Table>>`: Formatted summary table
        """)


if __name__ == "__main__":
    main()


